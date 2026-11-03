# MCPGeneration-for-ElevenLabs

Servidor MCP local por `stdio` para usar APIs oficiais da ElevenLabs com validação de pedidos, controlo de custos, armazenamento local e exportação de áudio para Godot. O código deste repositório foi desenvolvido de raiz; não depende de outro MCP.

## Estado

- Node.js 24+, TypeScript 6, MCP TypeScript SDK v2, SDK JavaScript oficial ElevenLabs e SQLite.
- `DRY_RUN=true` e `ALLOW_PAID_GENERATIONS=false` por padrão. Nenhuma ferramenta de geração envia pedidos pagos sem a política local e a autorização por chamada.
- Os pedidos HTTP são validados contra o snapshot OpenAPI oficial incluído em `src/schemas/elevenlabs-openapi.json`.
- O servidor inicia sem uma chave API para permitir descobrir as ferramentas e usar operações locais; chamadas remotas falham com `missing_api_key`.
- Suporte parcial e itens em falta estão detalhados em [docs/API_MATRIX.md](docs/API_MATRIX.md) e [docs/IMPLEMENTATION_REPORT.md](docs/IMPLEMENTATION_REPORT.md).

## Requisitos

- Node.js 24 ou superior e npm.
- FFmpeg e FFprobe no `PATH` para conversão, corte, loops, mistura e exportação Godot.
- Chave de API ElevenLabs para operações remotas. A disponibilidade depende da conta, permissões, plano e modelo; o servidor não presume acesso Starter.

O ambiente de desenvolvimento usado para esta implementação não tem FFmpeg/FFprobe. O servidor e os testes offline não dependem deles, mas as transformações locais requerem a instalação dos binários.

## Instalação

```bash
npm ci
cp .env.example .env.local
```

Edite `.env.local` e defina `ELEVENLABS_API_KEY`. O arquivo é ignorado pelo Git. Por segurança, mantenha `DRY_RUN=true` até estar pronto para autorizar geração paga.

```bash
npm run build
npm run doctor
npm start
```

`npm start` comunica apenas pelo protocolo MCP em `stdio`; não o execute num terminal interativo como se fosse uma CLI. Use `npm run dev` durante o desenvolvimento.

## Custos e autorização

Leia [docs/COST_MANAGEMENT.md](docs/COST_MANAGEMENT.md). Para ativar gerações pagas, defina `DRY_RUN=false` e `ALLOW_PAID_GENERATIONS=true`; cada chamada de geração também exige `allow_paid=true`. Como a API não fornece um custo de pré-validação confiável para todas as famílias, o custo desconhecido requer `allow_unknown_cost=true` para cada pedido. Estes controlos são uma barreira local, não uma estimativa de preço ou substituto dos limites da conta ElevenLabs.

`create_composition_plan` é documentado pela ElevenLabs como sem consumo de créditos, mas continua sujeito a autenticação e rate limits. Consultas e downloads de resultados existentes são operações de leitura.

## Ferramentas

As ferramentas estão agrupadas em conta/capacidades, TTS, diálogo, efeitos sonoros, música, vozes, transcrição/alinhamento, dobragem, imagens/vídeo, Flows/assets, histórico, orçamento e gestão local de mídia. Para schemas e parâmetros, consulte [docs/TOOL_REFERENCE.md](docs/TOOL_REFERENCE.md).

Exemplos de ferramentas locais:

- `get_budget_status`, `estimate_cost`, `set_local_budget`
- `inspect_media`, `convert_audio`, `normalize_audio`, `trim_audio`, `loop_audio`, `split_audio`, `merge_audio`
- `export_to_godot`, `extract_music_stems`, `get_sound_effect_presets`

Exemplos de geração (pagamento bloqueado por padrão):

- `generate_speech`, `generate_speech_with_timestamps`, `generate_dialogue`
- `generate_sound_effect`, `generate_ambient_audio`
- `generate_music`, `generate_music_detailed`, `generate_music_from_video`, `separate_music_stems`
- `design_voice`, `clone_voice`, `transcribe_audio`, `align_audio_to_text`, `isolate_voice`

## Armazenamento e segurança

- Saídas em `generated/`; SQLite e eventos locais em `data/`.
- Caminhos de entrada limitados a `GENERATED_DIR` e `ALLOWED_ROOTS`.
- Escritas atómicas, verificação de assinaturas, limites de bytes, prevenção de symlink/traversal e download restrito a URLs assinadas da ElevenLabs no domínio esperado.
- Clonagem e finetunes exigem confirmação de direitos; exclusões remotas exigem confirmação explícita.
- Logs vão para `stderr`; stdout fica reservado ao MCP.

Mais detalhes em [docs/SECURITY.md](docs/SECURITY.md).

## Integrar com Codex ou Claude Code

Compile primeiro. Copie e adapte os exemplos sem colocar a chave API em ficheiros de configuração versionados:

- [Configuração Codex](examples/codex/config.toml)
- [Configuração Claude Code](examples/claude-code/README.md)

As instruções atuais dos clientes estão em [Codex MCP](https://developers.openai.com/codex/mcp) e [Claude Code MCP](https://code.claude.com/docs/en/mcp). Nenhuma configuração global do utilizador é alterada por este repositório.

## Godot

`export_to_godot` recebe explicitamente a pasta autorizada do projeto, converte conforme o perfil escolhido, escreve o áudio e atualiza `.mcp-generation/assets.json`. Consulte [docs/GODOT_INTEGRATION.md](docs/GODOT_INTEGRATION.md) e o exemplo em `examples/godot/`.

## Desenvolvimento e verificações

```bash
npm run dev
npm run typecheck
npm run lint
npm run format:check
npm test
npm run check
```

`npm run smoke:real` é opt-in e não é incluído em `check`, testes ou CI. Sem `--paid`, consulta apenas a conta e os modelos. Uma chamada de geração requer `--paid --confirm-paid-call --allow-unknown-cost`, as duas autorizações de execução e `ELEVENLABS_SMOKE_VOICE_ID`. Consulte `docs/IMPLEMENTATION_REPORT.md` para os resultados realmente obtidos nesta máquina.

## Fontes oficiais

- [ElevenLabs API e documentação](https://elevenlabs.io/docs)
- [OpenAPI usada como fonte de contratos](https://api.elevenlabs.io/openapi.json)
- [SDK JavaScript oficial](https://github.com/elevenlabs/elevenlabs-js)
- [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)
- [Node.js](https://nodejs.org/), [Godot 4](https://docs.godotengine.org/en/stable/), [FFmpeg](https://ffmpeg.org/documentation.html)

Licença MIT. Consulte [LICENSE](LICENSE).
