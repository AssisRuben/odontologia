# Gravar com termos de odontologia — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Com IA conectada, a voz vira texto só pelo Gravar, e o Gravar envia à OpenAI uma lista de termos de odontologia.

**Architecture:** Função pura decide quais botões aparecem; `AiClient.transcribe` ganha `opts.prompt`; a rota `/api/ia/transcrever` passa o prompt de odontologia (o WhatsApp não).

**Tech Stack:** Next.js 16, React 19, OpenAI SDK, Vitest.

**Spec:** docs/superpowers/specs/2026-11-26-gravar-termos-design.md

## Global Constraints
- Rodar Vitest pelo PowerShell.
- Textos ao usuário em português, sem jargão.

## Review Focus
- IA conectada mas navegador sem `MediaRecorder` → Ditar aparece (teste em Task 1).
- Sem IA e sem reconhecimento de voz → nenhum botão (comportamento atual; teste em Task 1).
- Transcrição do WhatsApp continua sem prompt (teste em Task 2).

---

### Task 1: Quais botões de voz aparecem

**Files:** Modify `src/components/ia/fala.ts`, `src/components/ia/BarraVoz.tsx`; Test `tests/ia/fala.test.ts` (criar ou acrescentar)

**Interfaces:** Produces `botoesVoz({ podeDitar, podeGravar, iaConectada }: { podeDitar: boolean; podeGravar: boolean; iaConectada: boolean }): { ditar: boolean; gravar: boolean }`

- [ ] Teste `botoesVoz`: IA + grava → `{ ditar: false, gravar: true }`; sem IA → `{ ditar: podeDitar, gravar: false }`; IA sem gravação → `{ ditar: true, gravar: false }` (com podeDitar); nada disponível → ambos false.
- [ ] Rodar: falha (função não existe).
- [ ] Implementar em `fala.ts`; usar em `BarraVoz` (`podeGravar = mime !== null`, `iaConectada = gravarDisponivel`) nos quatro botões.
- [ ] Rodar: passa. Commit.

### Task 2: Prompt de termos na transcrição

**Files:** Create `src/lib/ia/termosOdonto.ts`; Modify `src/lib/ia/openai.ts`, `src/app/api/ia/transcrever/route.ts`; Test `tests/ia/openai.test.ts`

**Interfaces:** Produces `PROMPT_TRANSCRICAO_ODONTO: string`; `AiClient.transcribe(audio: File, opts?: { prompt?: string }): Promise<string>`

- [ ] Testes: com `{ prompt: 'p' }` o SDK recebe `prompt: 'p'`; sem opts a chamada fica exatamente `{ model, file, languages: ['pt'] }` (teste atual, cobre WhatsApp); `PROMPT_TRANSCRICAO_ODONTO` contém "oclusal", "mesial", "Elmex".
- [ ] Rodar: falha.
- [ ] Implementar; a rota chama `transcribe(renamed, { prompt: PROMPT_TRANSCRICAO_ODONTO })`.
- [ ] Rodar: passa. Commit.

### Task 3: Ajuda e verificação

**Files:** Modify `src/content/ajuda/pacientes.md:77`

- [ ] Texto: com IA conectada aparece **Gravar** (reconhece termos de odontologia); sem IA, **Ditar**.
- [ ] tsc, eslint, suíte inteira; navegador: evolução com IA mostra só Gravar; sem IA (rota de status falsa via `p.route`) mostra só Ditar. Commit.
