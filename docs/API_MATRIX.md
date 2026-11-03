# Matriz de APIs

## Fonte e método de validação

A fonte de contrato é o snapshot oficial `src/schemas/elevenlabs-openapi.json`, obtido de [api.elevenlabs.io/openapi.json](https://api.elevenlabs.io/openapi.json). A URL indicada em documentação antiga `elevenlabs.io/docs/openapi.json` não serviu JSON durante a pesquisa; o host da API serviu o documento OpenAPI 3.1.0 (331 paths). Pedidos HTTP cobertos pelo fallback passam por Ajv antes da rede. Chamadas encapsuladas pelo SDK oficial usam schemas e tipos do SDK, e não são revalidadas por este adapter.

Legenda: **Completo** = ferramenta para a operação documentada, com validação e persistência relevante; **Parcial** = fluxo útil, mas nem todos os modos/ações do grupo; **Não** = não exposto nesta versão. Disponibilidade do plano/conta permanece variável e não é inferida da OpenAPI.

## Conta e vozes

| Método / caminho                                    | Estado   | Ferramenta / observação                                                      |
| --------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `GET /v1/user`                                      | Completo | `get_account_info`, SDK oficial                                              |
| `GET /v1/user/subscription`                         | Completo | `get_subscription`; reporta campos expostos, não converte uso em previsão    |
| `GET /v1/models`                                    | Completo | `list_models`, SDK oficial                                                   |
| `GET /v2/voices`                                    | Completo | `list_voices`                                                                |
| `GET /v1/voices/{voice_id}`                         | Completo | `get_voice`                                                                  |
| `GET /v1/voices/{voice_id}/settings`                | Completo | `get_voice_settings`                                                         |
| `POST /v1/voices/{voice_id}/settings/edit`          | Completo | `update_voice_settings`                                                      |
| `DELETE /v1/voices/{voice_id}`                      | Completo | `delete_voice`, exige confirmação                                            |
| `GET /v1/audio-effects/catalog`                     | Completo | `list_audio_effects`                                                         |
| `POST /v1/text-to-voice/design`                     | Completo | `design_voice`; previews Base64 guardadas localmente e removidas da resposta |
| `POST /v1/text-to-voice`                            | Completo | `create_voice_from_preview`; confirmação e gates de custo                    |
| `POST /v1/text-to-voice/{voice_id}/remix`           | Completo | `remix_voice`; requer gates pagos                                            |
| `GET /v1/text-to-voice/{generated_voice_id}/stream` | Completo | `get_voice_preview`                                                          |
| `POST /v1/voices/add`                               | Completo | `clone_voice`; até 3 amostras, confirmação de direitos e gates pagos         |
| `POST /v1/text-to-voice/create-previews`            | Não      | Não exposto separadamente nesta versão                                       |
| PVC/Professional Voice Clone                        | Não      | Requer permissões e fluxo que esta versão não implementa                     |

## Áudio e música

| Método / caminho                                            | Estado             | Ferramenta / observação                                                                                    |
| ----------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `POST /v1/text-to-speech/{voice_id}`                        | Completo           | `generate_speech`                                                                                          |
| `POST /v1/text-to-speech/{voice_id}/stream`                 | Parcial            | `generate_speech_stream`; endpoint de stream, arquivo só é devolvido quando a resposta termina             |
| `POST /v1/text-to-speech/{voice_id}/with-timestamps`        | Completo           | `generate_speech_with_timestamps`; áudio `.mp3` e alinhamento `.json`                                      |
| `POST /v1/text-to-speech/{voice_id}/stream/with-timestamps` | Parcial            | `generate_speech_stream_with_timestamps`; mesma limitação de buffering                                     |
| `POST /v1/text-to-dialogue`                                 | Completo           | `generate_dialogue`; limite local de vozes distintas e caracteres                                          |
| `POST /v1/text-to-dialogue/stream`                          | Parcial            | `generate_dialogue_stream`                                                                                 |
| `POST /v1/text-to-dialogue/with-timestamps`                 | Completo           | `generate_dialogue_with_timestamps`; áudio separado de timing/segmentos                                    |
| `POST /v1/text-to-dialogue/stream/with-timestamps`          | Parcial            | `generate_dialogue_stream_with_timestamps`                                                                 |
| `POST /v1/sound-generation`                                 | Completo           | `generate_sound_effect`, `generate_ambient_audio`; preset local em `get_sound_effect_presets`              |
| `POST /v1/music` e `/v1/music/stream`                       | Completo / Parcial | `generate_music`, `generate_music_stream`; prompt ou plano, stream guardado após resposta                  |
| `POST /v1/music/detailed` e `/v1/music/detailed/stream`     | Completo / Parcial | `generate_music_detailed` e variante; parser `multipart/mixed` guarda áudio e metadados                    |
| `POST /v1/music/plan`                                       | Completo           | `create_composition_plan`; documentação atual indica endpoint sem consumo de créditos, com rate limits     |
| `POST /v1/music/video-to-music`                             | Completo           | `generate_music_from_video`; 1–10 vídeos, corpo e arquivo multipart conforme contrato                      |
| `POST /v1/music/upload`                                     | Completo           | `upload_music`; geração/treino posterior não é inventado                                                   |
| `POST /v1/music/stem-separation`                            | Completo           | `separate_music_stems`; guarda ZIP e extrai stems de áudio seguros                                         |
| `GET/POST /v1/music/finetunes`                              | Parcial            | lista e criação disponíveis apenas com `ENABLE_MUSIC_FINETUNES=true`; criação exige direitos e gates pagos |
| `GET/PATCH/DELETE /v1/music/finetunes/{finetune_id}`        | Parcial            | obter, editar e excluir; exclusão requer confirmação                                                       |
| Music inpainting/upload de contexto                         | Parcial            | upload e flags documentados podem ser enviados; edição real de trechos não é exposta                       |
| Music continuation/remix                                    | Não                | nenhum endpoint inventado                                                                                  |

## Transformação, transcrição e dobragem

| Método / caminho                                                                          | Estado   | Ferramenta / observação                                      |
| ----------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| `POST /v1/voice-changer/{voice_id}`                                                       | Completo | `change_voice`                                               |
| `POST /v1/speech-to-text`                                                                 | Completo | `transcribe_audio`; JSON local                               |
| `GET /v1/speech-to-text/transcripts/{transcription_id}`                                   | Completo | `get_transcription`                                          |
| `POST /v1/forced-alignment`                                                               | Completo | `align_audio_to_text`                                        |
| `POST /v1/audio-isolation`                                                                | Completo | `isolate_voice`; não é separação de stems musicais           |
| `POST /v1/audio-isolation/stream`                                                         | Não      | Não exposto                                                  |
| `GET /v1/audio-isolation/history`, `DELETE /v1/audio-isolation/history/{history_item_id}` | Não      | Não exposto                                                  |
| `POST /v1/dubbing/project`                                                                | Completo | `create_dubbing_project`, arquivo local e job persistido     |
| `GET /v1/dubbing/project`, `GET /v1/dubbing/project/{project_id}`                         | Completo | listar projetos e consultar/reconciliar estado               |
| `POST /v1/dubbing/project/{project_id}/language`                                          | Completo | `add_dubbing_language`                                       |
| `GET /v1/dubbing/{dubbing_id}/audio/{language_code}`                                      | Completo | `download_dubbed_media`                                      |
| `DELETE /v1/dubbing/project/{project_id}`                                                 | Completo | exige confirmação                                            |
| Endpoints de edição de segmento, speaker, transcript e render                             | Não      | Dubbing Studio completo não está coberto                     |
| Endpoints legados de `/v1/dubbing`                                                        | Parcial  | apenas download de áudio é exposto; consultar seção anterior |
| `transcript_to_subtitles`                                                                 | Local    | cria SRT/WebVTT de resultados com timestamps                 |

## Imagem, vídeo, Flows e histórico

| Método / caminho                                                                    | Estado   | Ferramenta / observação                                                   |
| ----------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| `POST/GET /v1/flows/image`, `GET /v1/flows/image/{generation_id}`                   | Completo | gerar/listar/obter; flag local desligada por padrão                       |
| `POST/GET /v1/flows/video`, `GET /v1/flows/video/{generation_id}`                   | Completo | gerar/listar/obter; flag local desligada por padrão                       |
| Download de resultado image/video                                                   | Completo | `download_image`, `download_video`; host/path e MIME/assinatura validados |
| `POST/GET /v1/flows/text-to-speech`, `GET /v1/flows/text-to-speech/{generation_id}` | Parcial  | criar e obter; listagem de gerações async de fala não é exposta           |
| `GET /v1/flows/templates`, `GET /v1/flows/templates/{template_id}`                  | Completo | listar e ler templates publicados                                         |
| `POST/GET /v1/flows/templates/{template_id}/runs`, `GET .../{run_id}`               | Parcial  | executar/obter; listagem das execuções não é exposta                      |
| `POST/GET/DELETE /v1/assets` e `/v1/assets/{asset_id}`                              | Completo | upload exige confirmação de direitos; delete exige confirmação            |
| `GET /v1/history`, `GET /v1/history/{history_item_id}`                              | Completo | listar e obter histórico                                                  |
| `GET /v1/history/{history_item_id}/audio`, `DELETE /v1/history/{history_item_id}`   | Completo | download e exclusão confirmada                                            |
| `POST /v1/workspace/analytics/requests`, `/usage-by-product-over-time`              | Completo | queries de analytics podem exigir permissão de workspace                  |
| `POST /v1/history/download`                                                         | Não      | download em lote não exposto                                              |

## Ficheiros e exportação

Operações locais não fazem chamadas remotas: inspeção de mídia, conversão, normalização, corte, repetição simples, divisão, mistura, exportação para perfis Godot, listagem de ativos e extração ZIP de stems. FFmpeg/FFprobe são necessários para transcodificação; um loop por repetição não promete fronteira sem emenda.

## Atualização

Para alterar uma rota, confirme método, parâmetros, formatos e resposta no snapshot atual e documentação de produto. Atualize o snapshot por revisão explícita e escreva teste sem rede. Não derive preços de `character-cost`, limites de assinatura, nem capacidades de modelos por inferência.
