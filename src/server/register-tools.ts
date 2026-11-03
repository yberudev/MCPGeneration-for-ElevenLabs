import type { McpServer } from "@modelcontextprotocol/server";
import type { AppContext } from "./context.js";
import { registerAccountTools } from "../tools/account/tools.js";
import { registerSpeechTools } from "../tools/speech/tools.js";
import { registerSoundTools } from "../tools/sound-effects/tools.js";
import { registerMusicTools } from "../tools/music/tools.js";
import { registerVoiceTools } from "../tools/voices/tools.js";
import { registerTranscriptionTools } from "../tools/transcription/tools.js";
import { registerDubbingTools } from "../tools/dubbing/tools.js";
import { registerHistoryTools } from "../tools/history/tools.js";
import { registerFlowTools } from "../tools/flows/tools.js";
import { registerCreativeTools } from "../tools/creative/tools.js";
import { registerMediaTools } from "../tools/media/tools.js";

export function registerTools(server: McpServer, context: AppContext): void {
  registerAccountTools(server, context);
  registerSpeechTools(server, context);
  registerSoundTools(server, context);
  registerMusicTools(server, context);
  registerVoiceTools(server, context);
  registerTranscriptionTools(server, context);
  registerDubbingTools(server, context);
  registerHistoryTools(server, context);
  registerFlowTools(server, context);
  registerCreativeTools(server, context);
  registerMediaTools(server, context);
}
