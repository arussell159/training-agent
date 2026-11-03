export const nutritionAddPrefix = (scope: string) =>
  `nutrition-add-outbox-v1:${scope}:`
export function hasQueuedFoodAdds(
  storage: Pick<Storage, "length" | "key">,
  scope: string
) {
  for (let i = 0; i < storage.length; i++)
    if (storage.key(i)?.startsWith(nutritionAddPrefix(scope))) return true
  return false
}
