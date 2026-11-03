# Claude Code

Depois de compilar (`npm run build`), adicione o servidor local com o caminho absoluto da pasta:

```bash
claude mcp add --transport stdio mcpgeneration_elevenlabs -- \
  node --env-file=/absolute/path/to/MCPGeneration-for-ElevenLabs/.env.local \
  /absolute/path/to/MCPGeneration-for-ElevenLabs/dist/index.js
```

Não passe a chave API como argumento. Guarde-a no `.env.local` do projeto. Confirme a ligação com `claude mcp list` e `claude mcp get mcpgeneration_elevenlabs`; remova-a com `claude mcp remove mcpgeneration_elevenlabs`.

O comando oficial do Claude Code usa `--transport stdio` e separa opções do cliente/comando com `--`. Ajuste os caminhos ao seu checkout. Esta configuração não é aplicada automaticamente.
