/**
 * Texto de referência enviado à transcrição (Gravar) de evoluções e anamneses.
 * A OpenAI usa o prompt como contexto de vocabulário: os termos que a transcrição
 * comum troca por palavras parecidas (ex.: "a oclusal do 46" virava "álcool zawdo 46").
 * Só listas, sem frases de exemplo: em áudio curto ou mudo o modelo pode copiar frases do prompt.
 * Não vale para áudios de pacientes no WhatsApp.
 */
export const PROMPT_TRANSCRICAO_ODONTO = [
  'Prontuário odontológico: evolução clínica e anamnese.',
  'Faces: oclusal, mesial, distal, vestibular, lingual, palatina, incisal, cervical.',
  'Dentes 11 a 18, 21 a 28, 31 a 38, 41 a 48 (ex.: 16, 36, 46); decíduos 51 a 85.',
  'Termos: resina, bloco, onlay, inlay, coroa, faceta, pino, núcleo, provisório, endodontia, tratamento de canal, pulpotomia, pulpectomia, exodontia, extração, siso, implante, enxerto, prótese, profilaxia, raspagem, polimento, tártaro, gengivite, periodontite, cárie, lesão, bruxismo, placa miorrelaxante, aparelho ortodôntico, manutenção, clareamento, selante, flúor, anestesia, radiografia, periapical, panorâmica, hipersensibilidade.',
  'Produtos: Elmex, Duraphat, Sensodyne, Colgate, Oral-B, clorexidina, Periogard, hidróxido de cálcio, ionômero de vidro.',
].join(' ')
