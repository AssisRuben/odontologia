# Gravar com termos de odontologia — design curto

**Por quê.** No teste, o Ditar (reconhecimento de voz do navegador) trocou termos técnicos por palavras comuns: "a oclusal do 46" → "álcool zawdo 46", "dei Elmex e na próxima" → "Deiammexina próxima". O Ditar não aceita vocabulário; a transcrição da OpenAI (Gravar) aceita um texto de referência (`prompt`).

**Objetivo.** Quem tem IA conectada usa a transcrição que reconhece termos de odontologia.

## Abordagens consideradas
1. Lista de termos no Gravar e só Gravar para quem tem IA. **Escolhida pelo usuário.**
2. Corrigir termos depois com IA (no "Organizar com IA" ou botão próprio): palpite sobre texto já errado; não escolhida agora.
3. Trocar o motor do Ditar pela transcrição ao vivo da OpenAI: muito mais trabalho e custo por minuto em todo ditado; fica para depois, se fizer falta.

## Decidido
- Com IA conectada e navegador que grava áudio: só **Gravar**.
- Sem IA: só **Ditar** (como hoje).
- Com IA mas navegador sem gravação de áudio: **Ditar** aparece no lugar (decisão minha, para não ficar sem opção).
- Vale para evolução e anamnese (mesmo componente `BarraVoz`).
- `/api/ia/transcrever` envia à OpenAI um `prompt` em português com termos de odontologia (faces, dentes FDI, procedimentos, produtos comuns). O áudio do WhatsApp (pacientes) não recebe esse prompt: `transcribe` ganha o prompt como opção.
- Ajuda (`pacientes.md`, e onde mais citar os dois botões) atualizada.

## Fica com quem implementa
- Texto exato da lista de termos (curto; o usuário pode mandar termos da equipe depois).

## Fora do escopo
- Correção pós-transcrição; mudar o Ditar.
