# Gestão de custos

## Defaults seguros

`.env.example` define `DRY_RUN=true`, `ALLOW_PAID_GENERATIONS=false`, `MAX_CONCURRENT_GENERATIONS=1`, `MAX_CREDITS_PER_REQUEST=500` e `MAX_MONTHLY_CREDITS=5000`. O valor de teto não estima custo por chamada. Nenhum tool gera mídia enquanto dry-run está ligado.

Para uma geração paga intencional, altere ambos os flags locais e envie em cada chamada `allow_paid=true`. Se o custo prévio for desconhecido, passe ainda `allow_unknown_cost=true`. O schema rejeita valores mutuamente exclusivos e o validador oficial confere o contrato antes da reserva/rede.

## O que é medido

- Reserva transacional local antes de submissão.
- Slots de concorrência e limites para estimativas explícitas.
- Estado `unknown` para timeout, erro de servidor ou resposta que falha depois da submissão.
- Histórico local, pedido, hashes e IDs remotos.
- Header `character-cost` guardado como contagem recebida, sem conversão para créditos.

A API atual não fornece uma prévia uniforme de créditos para TTS, diálogo, SFX, música, voz, transcrição, dubbing, imagem e vídeo. Portanto, `estimate_cost` deixa o valor em falta e a política não apresenta um custo inventado. O endpoint de plano musical é descrito pela documentação como sem custo em créditos, mas continua sujeito a rate limits.

## Alterar limites

`set_local_budget` ajusta teto por chamada, teto mensal e concorrência no SQLite. Isto não liga geração paga nem sobrepõe limites da conta. `get_budget_status` expõe reservas pendentes e resultados desconhecidos; reconcilie jobs assíncronos consultando as ferramentas de estado.

## Smoke test real

`npm run smoke:real` não é chamado por `npm test`, `npm run check` ou CI. O modo de leitura é padrão; chamadas reais requerem `--paid --confirm-paid-call --allow-unknown-cost`, `ELEVENLABS_API_KEY`, `DRY_RUN=false`, `ALLOW_PAID_GENERATIONS=true` e um voice ID explícito. O modo pago chama TTS e pode consumir créditos.
