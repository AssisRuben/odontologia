export type ProviderCharge = {
  id: string
  installmentId: string | null
  installmentNumber: number | null
  status: string
  deleted: boolean
  valueCents: number
  netValueCents: number | null
  dueDate: string
  paidAt: string | null
  invoiceUrl: string | null
  externalReference: string | null
}
