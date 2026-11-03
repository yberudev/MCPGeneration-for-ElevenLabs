import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { AppError } from "../utils/errors.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

interface OperationSpec {
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: Record<string, unknown> }>;
  requestBody?: { content?: Record<string, { schema?: Record<string, unknown> }> };
}
interface OpenApiSpec {
  paths: Record<string, Record<string, OperationSpec>>;
  components: { schemas: Record<string, unknown> };
}

const specUrl = "https://api.elevenlabs.io/openapi.json";

export class OpenApiContracts {
  private readonly spec: OpenApiSpec;
  private readonly ajv: Ajv2020;
  private readonly pathMap: Array<{ template: string; expression: RegExp }>;
  private readonly validators = new Map<string, ValidateFunction>();

  constructor() {
    this.spec = JSON.parse(
      readFileSync(new URL("../schemas/elevenlabs-openapi.json", import.meta.url), "utf8"),
    ) as OpenApiSpec;
    this.ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
    addFormats(this.ajv);
    this.ajv.addFormat("binary", true);
    this.ajv.addSchema({ ...this.spec, $id: specUrl, $schema: "https://json-schema.org/draft/2020-12/schema" });
    this.pathMap = Object.keys(this.spec.paths).map((template) => {
      const escapedPath = template
        .split("/")
        .map((segment) =>
          segment.startsWith("{") && segment.endsWith("}") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("/");
      return { template, expression: new RegExp(`^${escapedPath}$`) };
    });
  }

  validate(method: string, path: string, body: unknown, query: Record<string, unknown> = {}, form?: FormData): void {
    const pathOnly = path.split("?", 1)[0] ?? path;
    const match = this.pathMap.find((candidate) => candidate.expression.test(pathOnly));
    if (!match)
      throw new AppError(`No official OpenAPI contract matches ${method} ${pathOnly}`, "unknown_api_contract");
    const operation = this.spec.paths[match.template]?.[method.toLowerCase()];
    if (!operation)
      throw new AppError(
        `The official OpenAPI does not define ${method} ${match.template}`,
        "unsupported_api_operation",
      );
    const queryParameters = (operation.parameters ?? []).filter((parameter) => parameter.in === "query");
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      const parameter = queryParameters.find((candidate) => candidate.name === key);
      if (!parameter)
        throw new AppError(
          `Query parameter ${key} is not documented for ${method} ${match.template}`,
          "unknown_api_parameter",
        );
      const schema = parameter.schema;
      if (schema && !this.validateSchema(schema, this.toSchemaValue(value, schema), `query.${key}`))
        throw this.validationError(`query.${key}`);
    }
    for (const parameter of queryParameters) {
      if (parameter.required && query[parameter.name] === undefined)
        throw new AppError(`Required query parameter ${parameter.name} is missing`, "missing_api_parameter");
    }
    const content = operation.requestBody?.content;
    if (!content) {
      if (body !== undefined && (typeof body !== "object" || body === null || Object.keys(body).length > 0))
        throw new AppError(`This operation has no request body in the official OpenAPI`, "unexpected_api_body");
      return;
    }
    const mediaType = form ? "multipart/form-data" : "application/json";
    const bodySchema = content[mediaType]?.schema;
    if (!bodySchema)
      throw new AppError(
        `The official OpenAPI does not define ${mediaType} for ${method} ${match.template}`,
        "unsupported_api_body_type",
      );
    let payload = body;
    if (form) payload = formToObject(form);
    if (!this.validateSchema(bodySchema, payload, "body")) throw this.validationError("body");
  }

  private validateSchema(schema: Record<string, unknown>, value: unknown, label: string): boolean {
    const cacheKey = JSON.stringify(schema);
    let validator = this.validators.get(cacheKey);
    if (!validator) {
      const validationTarget =
        typeof schema.$ref === "string"
          ? { $ref: `${specUrl}${schema.$ref}` }
          : {
              ...(qualifyReferences(schema, specUrl) as Record<string, unknown>),
              $id: `https://api.elevenlabs.io/runtime-validation/${this.validators.size}`,
            };
      validator = this.ajv.compile(validationTarget);
      this.validators.set(cacheKey, validator);
    }
    const valid = validator(value);
    if (!valid)
      this.lastErrors = (validator.errors ?? [])
        .slice(0, 6)
        .map((error) => `${label}${error.instancePath || ""} ${error.message ?? "is invalid"}`);
    else this.lastErrors = [];
    return Boolean(valid);
  }

  private lastErrors: string[] = [];

  private validationError(label: string): AppError {
    const details = this.lastErrors.length ? `: ${this.lastErrors.join("; ")}` : "";
    return new AppError(
      `Request does not match the current official ElevenLabs OpenAPI contract for ${label}${details}`,
      "openapi_validation_failed",
    );
  }

  private toSchemaValue(value: unknown, schema: Record<string, unknown>): unknown {
    if (schema.type === "integer" || schema.type === "number") return Number(value);
    if (schema.type === "boolean") return value === true || value === "true";
    return String(value);
  }
}

function formToObject(form: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    const converted = typeof value === "string" ? value : "uploaded-file";
    if (Object.hasOwn(result, key))
      result[key] = Array.isArray(result[key]) ? [...(result[key] as unknown[]), converted] : [result[key], converted];
    else result[key] = converted;
  }
  return result;
}

function qualifyReferences(value: unknown, rootId: string): unknown {
  if (Array.isArray(value)) return value.map((item) => qualifyReferences(item, rootId));
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] =
      key === "$ref" && typeof item === "string" && item.startsWith("#/")
        ? `${rootId}${item}`
        : qualifyReferences(item, rootId);
  }
  return result;
}
