# Arquitetura

O processo inicia por `stdio` usando `serveStdio` do SDK MCP v2. `McpServer` regista ferramentas pequenas com schemas Zod v4; cada ferramenta encaminha para os serviços de geração/orçamento, mídia, cliente SDK ou adapter HTTP.

```text
Cliente MCP ─stdio─> registo MCP/Zod ─> serviços
                                      ├─ BudgetManager ─ SQLite
                                      ├─ GenerationService ─ OpenAPI contracts
                                      ├─ MediaManager ─ SQLite/ficheiros
                                      └─ MediaService ─ FFmpeg/FFprobe/metadata
                                                        │
                           SDK oficial ElevenLabs <────┴─ HTTP limitado a api.elevenlabs.io
```

## Módulos

- `src/server`: instanciação MCP, ciclo de vida e registo de ferramentas.
- `src/tools`: contratos MCP por família; operações que podem gerar mídia delegam ao `GenerationService`.
- `src/adapters/elevenlabs-client.ts`: SDK oficial para consultas compatíveis e HTTP fallback encapsulado.
- `src/adapters/elevenlabs-http.ts`: host fixo, chave `xi-api-key`, timeout, sem retry automático, limite de bytes, validação OpenAPI e download de mídia restrito a URL assinada.
- `src/services/openapi-contracts.ts`: Ajv valida método, caminho, parâmetros, corpo JSON ou formulário usando o snapshot da OpenAPI.
- `src/services/budget`: autorizações, reservas SQLite transacionais, limites locais e reconciliação de jobs remotos.
- `src/services/generation`: hash determinístico de pedido/ficheiros, validação anterior à chamada, reserva, pedido remoto, armazenamento e estado final/unknown.
- `src/services/media`: raízes permitidas, atomicidade, assinaturas, extração segura de stems, metadados e utilitários FFmpeg.
- `src/db/database.ts`: inicialização SQLite em WAL com migração inicial e tabelas de eventos, mídia, reservas e jobs.

## Fluxo de geração

1. Zod valida a entrada MCP.
2. Caminhos e arquivos são resolvidos dentro das raízes permitidas; calcula-se SHA-256 dos arquivos.
3. O pedido e query passam pelo schema correspondente da OpenAPI oficial.
4. Confere-se destino local, autorização paga, custo desconhecido, concorrência e limites.
5. A reserva e o evento são gravados antes da chamada remota.
6. Respostas são validadas e gravadas atomicamente. Timeout ou falha após submissão pode marcar o resultado como `unknown` porque a cobrança remota pode ter ocorrido.
7. Jobs assíncronos guardam o identificador e são reconciliados ao consultar o estado ou descarregar o resultado.

## Persistência

`generations` guarda pedido, endpoint, modelo, hash, estado e referências; `generation_events` mantém transições; `credit_reservations` controla slots ativos; `remote_jobs` associa recurso remoto ao ID local; `media_assets` guarda hash, tipo e caminho. A chave API nunca é persistida.

## Limites conhecidos

O adapter mantém resposta binária em memória até ao limite `MAX_MEDIA_BYTES`; as rotas de streaming da ElevenLabs são chamadas, mas o resultado é guardado depois de completar a resposta, não encaminhado em tempo real ao cliente MCP. O histórico, os fluxos e os jobs têm suporte parcial; ver matriz de APIs.
