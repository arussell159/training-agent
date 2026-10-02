import { useState } from "react"
import { Utensils } from "lucide-react"

const illustrations: [RegExp, string][] = [
  [/\b(pizza|hand tossed|stuffed crust|pan slice|crispy slice)\b/i, "🍕"],
  [/\b(banana|bananas)\b/i, "🍌"],
  [/\b(egg|eggs|omelet|omelette)\b/i, "🥚"],
  [/\b(rice|risotto)\b/i, "🍚"],
  [/\b(chicken|turkey|poultry|wing|wings)\b/i, "🍗"],
  [/\b(salmon|tuna|fish|seafood)\b/i, "🐟"],
  [/\b(steak|beef|pork)\b/i, "🥩"],
  [/\b(bread|breadsticks|toast|sandwich)\b/i, "🥪"],
  [/\b(pasta|spaghetti|noodles)\b/i, "🍝"],
  [/\b(salad|greens|vegetables)\b/i, "🥗"],
  [/\b(apple|apples)\b/i, "🍎"],
  [/\b(berries|strawberry|strawberries)\b/i, "🍓"],
  [/\b(oats|oatmeal|cereal|granola)\b/i, "🥣"],
  [/\b(milk|yogurt|yoghurt)\b/i, "🥛"],
  [/\b(cheese)\b/i, "🧀"],
  [/\b(coffee|tea)\b/i, "☕"],
  [/\b(tailwind|drink|juice|smoothie|shake)\b/i, "🥤"],
  [/\b(burger|hamburger)\b/i, "🍔"],
  [/\b(cookie|cookies)\b/i, "🍪"],
  [/\b(nuts|peanuts|almonds)\b/i, "🥜"],
]

export function FoodThumbnail({
  name,
  imageUrl,
}: {
  name: string
  imageUrl?: string | null
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const illustration = illustrations.find(([pattern]) =>
    pattern.test(name)
  )?.[1]
  return (
    <span className="nutrition-food-thumbnail" aria-hidden="true">
      {imageUrl && failedImage !== imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          width={44}
          height={44}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedImage(imageUrl)}
        />
      ) : (
        illustration || <Utensils className="size-5 text-muted-foreground" />
      )}
    </span>
  )
}
