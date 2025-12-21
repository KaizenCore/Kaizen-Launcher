import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"

// Safe account info from backend - NO TOKENS (security)
export interface SkinAccount {
  id: string
  uuid: string
  username: string
  skin_url: string | null
  is_active: boolean
  has_valid_token: boolean
  is_offline: boolean
}

// Generic types - the actual shape comes from the backend
// Using flexible types to avoid conflicts with component-specific types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SkinProfile = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StoreFavoriteSkin = any

interface SkinState {
  // Data
  activeAccount: SkinAccount | null
  profile: SkinProfile | null
  favorites: StoreFavoriteSkin[]
  favoritedIds: Set<string>

  // Loading states
  isLoading: boolean
  isLoadingFavorites: boolean

  // Cache timestamps
  profileLoadedAt: number | null
  favoritesLoadedAt: number | null

  // Actions
  loadProfile: (forceRefresh?: boolean) => Promise<void>
  loadFavorites: (forceRefresh?: boolean) => Promise<void>
  setProfile: (profile: SkinProfile | null) => void
  addFavorite: (skin: StoreFavoriteSkin) => void
  removeFavorite: (skinId: string) => void
  clearCache: () => void
}

// Cache duration: 5 minutes
const CACHE_DURATION = 5 * 60 * 1000

export const useSkinStore = create<SkinState>((set, get) => ({
  activeAccount: null,
  profile: null,
  favorites: [],
  favoritedIds: new Set(),
  isLoading: false,
  isLoadingFavorites: false,
  profileLoadedAt: null,
  favoritesLoadedAt: null,

  loadProfile: async (forceRefresh = false) => {
    const state = get()
    const now = Date.now()

    // Use cache if valid and not forcing refresh
    if (
      !forceRefresh &&
      state.profileLoadedAt &&
      now - state.profileLoadedAt < CACHE_DURATION &&
      state.activeAccount
    ) {
      console.log("[SkinStore] Using cached profile")
      return
    }

    console.log("[SkinStore] Loading skin profile...")
    set({ isLoading: true })

    try {
      const account = await invoke<SkinAccount | null>("get_active_account")

      // Check if account changed
      if (account?.id !== state.activeAccount?.id) {
        // Account changed, clear profile cache
        set({ profile: null, profileLoadedAt: null })
      }

      set({ activeAccount: account })

      if (account) {
        console.log(`[SkinStore] Loading profile for: ${account.username}`)
        try {
          const skinProfile = await invoke<SkinProfile>("get_skin_profile", {
            accountId: account.id,
          })
          console.log(`[SkinStore] Profile loaded, ${skinProfile.available_capes?.length || 0} capes`)
          set({
            profile: skinProfile,
            profileLoadedAt: now,
          })
        } catch (profileErr) {
          console.warn("[SkinStore] Failed to load skin profile:", profileErr)
          set({
            profile: {
              uuid: account.uuid,
              username: account.username,
              current_skin: null,
              available_capes: [],
              current_cape: null,
            },
            profileLoadedAt: now,
          })
        }
      }
    } catch (err) {
      console.error("[SkinStore] Failed to load account:", err)
    } finally {
      set({ isLoading: false })
    }
  },

  loadFavorites: async (forceRefresh = false) => {
    const state = get()
    const now = Date.now()

    // Use cache if valid and not forcing refresh
    if (
      !forceRefresh &&
      state.favoritesLoadedAt &&
      now - state.favoritesLoadedAt < CACHE_DURATION &&
      state.favorites.length > 0
    ) {
      console.log("[SkinStore] Using cached favorites")
      return
    }

    console.log("[SkinStore] Loading favorites...")
    set({ isLoadingFavorites: true })

    try {
      const favs = await invoke<StoreFavoriteSkin[]>("get_favorite_skins")
      console.log(`[SkinStore] Loaded ${favs.length} favorites`)
      set({
        favorites: favs,
        favoritedIds: new Set(favs.map((f) => f.skin_id)),
        favoritesLoadedAt: now,
      })
    } catch (err) {
      console.error("[SkinStore] Failed to load favorites:", err)
    } finally {
      set({ isLoadingFavorites: false })
    }
  },

  setProfile: (profile) => {
    set({ profile, profileLoadedAt: Date.now() })
  },

  addFavorite: (skin) => {
    set((state) => ({
      favorites: [...state.favorites, skin],
      favoritedIds: new Set([...state.favoritedIds, skin.skin_id]),
    }))
  },

  removeFavorite: (skinId) => {
    set((state) => {
      const newFavoritedIds = new Set(state.favoritedIds)
      newFavoritedIds.delete(skinId)
      return {
        favorites: state.favorites.filter((f) => f.skin_id !== skinId),
        favoritedIds: newFavoritedIds,
      }
    })
  },

  clearCache: () => {
    set({
      profileLoadedAt: null,
      favoritesLoadedAt: null,
    })
  },
}))
