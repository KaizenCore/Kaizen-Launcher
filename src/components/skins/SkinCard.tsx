import { useState } from "react"
import { Eye, Heart, Plus } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface CommunitySkin {
  id: string
  name: string
  url: string
  thumbnail_url: string
  variant: "classic" | "slim"
  source: "namemc" | "mineskin" | "local" | "mojang"
  author?: string
  downloads?: number
  likes?: number
}

interface SkinCardProps {
  skin: CommunitySkin
  onSelect?: (skin: CommunitySkin) => void
  onApply?: (skin: CommunitySkin) => void
  onPreview?: (skin: CommunitySkin) => void
  onFavorite?: (skin: CommunitySkin) => void
  isSelected?: boolean
  isFavorited?: boolean
  showApplyButton?: boolean
  showFavoriteButton?: boolean
  className?: string
}

export function SkinCard({
  skin,
  onSelect,
  onApply,
  onPreview,
  onFavorite,
  isSelected = false,
  isFavorited = false,
  showApplyButton = true,
  showFavoriteButton = true,
  className,
}: SkinCardProps) {
  const [imageError, setImageError] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  const handleClick = () => {
    onSelect?.(skin)
  }

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation()
    onPreview?.(skin)
  }

  const handleApply = (e: React.MouseEvent) => {
    e.stopPropagation()
    onApply?.(skin)
  }

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation()
    onFavorite?.(skin)
  }

  return (
    <Card
      className={cn(
        "relative overflow-hidden cursor-pointer transition-all hover:shadow-md",
        isSelected && "ring-2 ring-primary",
        className
      )}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <CardContent className="p-0">
        {/* Skin Preview Image */}
        <div className="relative aspect-[3/4] bg-gradient-to-b from-muted/30 to-muted/60">
          {!imageError ? (
            <img
              src={skin.thumbnail_url}
              alt={skin.name}
              className="w-full h-full object-contain p-2"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-muted-foreground text-sm">No Preview</span>
            </div>
          )}

          {/* Hover Overlay */}
          {isHovered && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-2 transition-opacity">
              <Button
                size="icon"
                variant="secondary"
                className="h-8 w-8"
                onClick={handlePreview}
              >
                <Eye className="h-4 w-4" />
              </Button>
              {showFavoriteButton && (
                <Button
                  size="icon"
                  variant={isFavorited ? "default" : "secondary"}
                  className={cn("h-8 w-8", isFavorited && "text-red-500")}
                  onClick={handleFavorite}
                >
                  <Heart className={cn("h-4 w-4", isFavorited && "fill-current")} />
                </Button>
              )}
              {showApplyButton && (
                <Button
                  size="icon"
                  variant="default"
                  className="h-8 w-8"
                  onClick={handleApply}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}

          {/* Variant Badge */}
          <Badge
            variant="secondary"
            className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0"
          >
            {skin.variant === "slim" ? "Alex" : "Steve"}
          </Badge>
        </div>

        {/* Info Section */}
        <div className="p-2">
          <p className="text-xs font-medium truncate">{skin.name}</p>
          {skin.author && (
            <p className="text-[10px] text-muted-foreground truncate">
              by {skin.author}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export type { CommunitySkin }
