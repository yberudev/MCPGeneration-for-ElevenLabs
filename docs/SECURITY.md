# Segurança

## Segredos e logs

- `ELEVENLABS_API_KEY` só é lida do ambiente, `.env.local` ou `.env`; não vai para SQLite, argumentos de request logados ou mensagens de sucesso.
- `.env.local`, `.env` e a base de dados estão ignorados pelo Git.
- Pino escreve em stderr. Respostas não despejam buffers de mídia.
- O adapter usa `xi-api-key`, host fixo `api.elevenlabs.io`, sem proxy arbitrário e sem retry automático.

## Ficheiros e rede

- Caminhos resolvidos têm de estar em `GENERATED_DIR`/`ALLOWED_ROOTS`; symlinks que escapem às raízes e componentes simbólicos de saída são rejeitados.
- Nomes de saída recusam traversal; arquivos e downloads respeitam `MAX_MEDIA_BYTES`.
- Áudio, imagens, ZIP, vídeo e assinaturas WebM são validados antes de serem registados.
- Download de output assinado aceita HTTPS, host `storage.googleapis.com`, caminho `/generations/`, sem credenciais URL, e recusa redirects.
- Extração de ZIP bloqueia traversal, symlinks, entradas não-áudio, excesso de entradas e expansão superior aos limites locais.
- FFmpeg é lançado sem shell, com argumentos separados e timeout.

## Operações com impacto

- Gerações ficam bloqueadas por `DRY_RUN` e autorização paga global e por chamada.
- Custo desconhecido permanece `null`, nunca zero; exige autorização adicional específica.
- Voz clone, uploads e finetunes pedem confirmação de direitos; exclusões remotas exigem confirmação.
- Imagem, vídeo e finetunes começam desligados por flags locais.

Os limites locais não controlam limites da conta, cobranças ou rate limits da ElevenLabs. Configure os limites no dashboard da conta e reveja a política antes de permitir chamadas reais.
