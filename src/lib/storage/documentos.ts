import type { SupabaseClient } from '@supabase/supabase-js'

const PUBLIC_MARKER = '/storage/v1/object/public/anneOdonto/'

/** Normaliza file_url (caminho ou URL pública legada) para o caminho no bucket. */
export function documentPath(fileUrl: string): string {
  const idx = fileUrl.indexOf(PUBLIC_MARKER)
  if (idx === -1) return fileUrl
  const rest = fileUrl.slice(idx + PUBLIC_MARKER.length).split('?')[0]
  try {
    return decodeURIComponent(rest)
  } catch {
    return rest
  }
}

/** Gera links temporários (1h). Caminhos que falharem ficam fora do mapa. */
export async function signedUrls(
  supabase: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600)
  const map: Record<string, string> = {}
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl
  }
  return map
}
