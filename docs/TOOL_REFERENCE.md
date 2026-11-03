# Referência das ferramentas

O servidor publica os schemas Zod que o MCP SDK expõe. Campos específicos de cada ferramenta são a fonte final; campos adicionais são recusados na maioria dos schemas.

## Política comum de geração

Chamadas potencialmente cobradas usam `allow_paid` e `allow_unknown_cost`, ambos falsos por padrão. Também requerem `DRY_RUN=false` e `ALLOW_PAID_GENERATIONS=true` no processo. Não existe estimativa local para a maioria dos produtos. Algumas ferramentas destrutivas acrescentam `confirm_delete`; clones e treinos pedem confirmação de direitos.

## Conta e orçamento

- `get_account_info`, `get_subscription`, `list_models`, `list_voices`, `get_voice`, `get_voice_settings`, `list_audio_effects`, `get_capabilities`
- `get_budget_status`, `get_usage_report`, `estimate_cost`, `set_local_budget`
- `estimate_cost` retorna `estimated_credits: null` quando a API não oferece preflight verificável; não converte contagem de caracteres em crédito.

## Fala, diálogos e efeitos

- `generate_speech`, `generate_speech_stream`, `generate_speech_with_timestamps`, `generate_speech_stream_with_timestamps`: texto, voice ID, modelo, língua, configurações, output_format, filename e gates.
- `generate_dialogue`, `generate_dialogue_stream`, `generate_dialogue_with_timestamps`, `generate_dialogue_stream_with_timestamps`: sequência de `{text, voice_id}`, até 10 IDs distintos e até 2.000 caracteres totais por chamada.
- `generate_sound_effect`, `generate_ambient_audio`: texto, duração de 0,5–30 s, loop, influência do prompt, modelo e formato.
- `get_sound_effect_presets`: prompts locais editáveis para categorias comuns de jogo.

Os nomes de output format são verificados pela OpenAPI, mas o acesso do plano a codecs/modelos continua a ser validado pela ElevenLabs.

## Música e vozes

- `create_composition_plan`, `generate_music`, `generate_music_stream`, `generate_music_detailed`, `generate_music_detailed_stream`
- `generate_music_from_video`, `separate_music_stems`, `upload_music`
- `list_music_finetunes`, `create_music_finetune`, `get_music_finetune`, `update_music_finetune`, `delete_music_finetune` (módulo desativado por padrão)
- `design_voice`, `create_voice_from_preview`, `remix_voice`, `get_voice_preview`, `clone_voice`, `update_voice_settings`, `delete_voice`

As variantes de streaming usam o endpoint de stream oficial, mas guardam a resposta completa em disco antes de devolver ao cliente MCP. As saídas detalhadas de música guardam arquivo de áudio e JSON de metadados.

## Transcrição, dobragem e criação visual

- `change_voice`, `transcribe_audio`, `get_transcription`, `align_audio_to_text`, `isolate_voice`, `transcript_to_subtitles`
- `create_dubbing_project`, `add_dubbing_language`, `list_dubbing_projects`, `get_dubbing_status`, `download_dubbed_media`, `delete_dubbing_project`
- `generate_image`, `list_image_generations`, `get_image_generation`, `download_image`; ferramentas análogas para vídeo
- `create_async_speech`, `get_async_speech`, templates/execuções Flows, upload/list/get/delete assets
- Histórico: listagem, metadata, download de áudio, analytics e delete com confirmação

Imagem, vídeo e finetunes requerem respetivas flags locais. A API pode ainda rejeitar acesso, modelo ou plano.

## Mídia local

- `inspect_media`, `convert_audio`, `normalize_audio`, `trim_audio`, `loop_audio`, `split_audio`, `merge_audio`
- `export_to_godot`, `list_generated_media`, `extract_music_stems`

Escreva sempre em `GENERATED_DIR` ou passe um projeto permitido em `ALLOWED_ROOTS`. `overwrite` tem de ser explicitamente ligado para substituir saídas.
