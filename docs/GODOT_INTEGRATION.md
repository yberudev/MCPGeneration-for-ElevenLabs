# Godot 4

`export_to_godot` usa um destino explícito dentro de uma pasta aprovada. Perfis locais:

| Perfil           | Formato de saída |
| ---------------- | ---------------- |
| `godot_sfx`      | WAV              |
| `godot_music`    | Ogg Vorbis       |
| `godot_dialogue` | Ogg Vorbis       |
| `godot_ambient`  | Ogg Vorbis       |
| `trailer_audio`  | MP3              |

O áudio é colocado na pasta escolhida e `.mcp-generation/assets.json` recebe caminho relativo, perfil, hash, bytes, data e metadados disponíveis. O Godot pode demorar até à próxima varredura do filesystem para importar o recurso. `overwrite=false` por padrão.

## Exemplo

1. Adicione a pasta do projeto Godot a `ALLOWED_ROOTS`.
2. Chame `export_to_godot` com `project_root` absoluto, `relative_path` como `assets/audio/music/exploration.ogg`, perfil `godot_music` e `overwrite=false`.
3. Abra/atualize o projeto no Godot e atribua o `.ogg` importado a um `AudioStreamPlayer`.

Um exemplo curto está em `examples/godot/AudioPreview.gd`. Não deixe o MCP substituir assets aprovados sem `overwrite=true`.
