import { useState, useEffect, useCallback, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import {
  Cloud,
  Loader2,
  Check,
  AlertCircle,
  Server,
  HardDrive,
  Eye,
  EyeOff,
  RefreshCw,
  ExternalLink,
  LogOut,
  Copy,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useTranslation } from "@/i18n"

type CloudProvider = "google_drive" | "nextcloud" | "s3" | "dropbox"

interface OAuthAvailability {
  google_drive: boolean
  dropbox: boolean
}

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

interface CloudStorageConfig {
  id: string
  provider: CloudProvider
  enabled: boolean
  auto_upload: boolean
  // Google Drive
  google_access_token: string | null
  google_refresh_token: string | null
  google_expires_at: string | null
  google_folder_id: string | null
  // Nextcloud
  nextcloud_url: string | null
  nextcloud_username: string | null
  nextcloud_password: string | null
  nextcloud_folder_path: string | null
  // S3
  s3_endpoint: string | null
  s3_region: string | null
  s3_bucket: string | null
  s3_access_key: string | null
  s3_secret_key: string | null
  s3_folder_prefix: string | null
  // Dropbox
  dropbox_access_token: string | null
  dropbox_refresh_token: string | null
  dropbox_expires_at: string | null
  dropbox_folder_path: string | null
}

interface ConnectionTestResult {
  success: boolean
  message: string
  storage_used: number | null
  storage_total: number | null
}

// Dropbox code entry sub-component
function DropboxCodeEntry({
  deviceCode,
  onSubmit,
  isAuthenticating,
}: {
  deviceCode: DeviceCodeResponse
  onSubmit: (code: string) => void
  isAuthenticating: boolean
}) {
  const { t } = useTranslation()
  const [code, setCode] = useState("")

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("cloudStorage.dropboxCodeInstructions")}
      </p>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => openUrl(deviceCode.verification_uri)}
      >
        <ExternalLink className="h-4 w-4 mr-2" />
        {t("cloudStorage.dropboxOpenAuth")}
      </Button>
      <div className="space-y-2">
        <Label>{t("cloudStorage.dropboxPasteCode")}</Label>
        <div className="flex gap-2">
          <Input
            placeholder="Enter code from Dropbox"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button
            onClick={() => onSubmit(code)}
            disabled={!code || isAuthenticating}
          >
            {isAuthenticating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t("cloudStorage.dropboxConnect")
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

const defaultConfig: CloudStorageConfig = {
  id: "global",
  provider: "nextcloud",
  enabled: false,
  auto_upload: false,
  google_access_token: null,
  google_refresh_token: null,
  google_expires_at: null,
  google_folder_id: null,
  nextcloud_url: null,
  nextcloud_username: null,
  nextcloud_password: null,
  nextcloud_folder_path: "/Kaizen Backups",
  s3_endpoint: null,
  s3_region: null,
  s3_bucket: null,
  s3_access_key: null,
  s3_secret_key: null,
  s3_folder_prefix: "kaizen-backups/",
  dropbox_access_token: null,
  dropbox_refresh_token: null,
  dropbox_expires_at: null,
  dropbox_folder_path: "/Kaizen Backups",
}

export function CloudStorageConfig() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<CloudStorageConfig>(defaultConfig)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)

  // OAuth states
  const [oauthAvailability, setOauthAvailability] = useState<OAuthAvailability>({ google_drive: false, dropbox: false })
  const [deviceCode, setDeviceCode] = useState<DeviceCodeResponse | null>(null)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // Password visibility
  const [showPassword, setShowPassword] = useState(false)
  const [showS3Secret, setShowS3Secret] = useState(false)

  // Form state
  const [provider, setProvider] = useState<CloudProvider>("nextcloud")
  const [enabled, setEnabled] = useState(false)
  const [autoUpload, setAutoUpload] = useState(false)

  // Nextcloud fields
  const [nextcloudUrl, setNextcloudUrl] = useState("")
  const [nextcloudUsername, setNextcloudUsername] = useState("")
  const [nextcloudPassword, setNextcloudPassword] = useState("")
  const [nextcloudFolderPath, setNextcloudFolderPath] = useState("/Kaizen Backups")

  // S3 fields
  const [s3Endpoint, setS3Endpoint] = useState("")
  const [s3Region, setS3Region] = useState("")
  const [s3Bucket, setS3Bucket] = useState("")
  const [s3AccessKey, setS3AccessKey] = useState("")
  const [s3SecretKey, setS3SecretKey] = useState("")
  const [s3FolderPrefix, setS3FolderPrefix] = useState("kaizen-backups/")

  // Track if initial load is done
  const isInitialLoadDone = useRef(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Load config
  const loadConfig = useCallback(async () => {
    setIsLoading(true)
    try {
      // Load OAuth availability
      const availability = await invoke<OAuthAvailability>("get_oauth_availability")
      setOauthAvailability(availability)

      const cloudConfig = await invoke<CloudStorageConfig | null>(
        "get_cloud_storage_config"
      )
      if (cloudConfig) {
        setConfig(cloudConfig)
        setProvider(cloudConfig.provider)
        setEnabled(cloudConfig.enabled)
        setAutoUpload(cloudConfig.auto_upload)
        // Nextcloud
        setNextcloudUrl(cloudConfig.nextcloud_url || "")
        setNextcloudUsername(cloudConfig.nextcloud_username || "")
        setNextcloudPassword(cloudConfig.nextcloud_password || "")
        setNextcloudFolderPath(cloudConfig.nextcloud_folder_path || "/Kaizen Backups")
        // S3
        setS3Endpoint(cloudConfig.s3_endpoint || "")
        setS3Region(cloudConfig.s3_region || "")
        setS3Bucket(cloudConfig.s3_bucket || "")
        setS3AccessKey(cloudConfig.s3_access_key || "")
        setS3SecretKey(cloudConfig.s3_secret_key || "")
        setS3FolderPrefix(cloudConfig.s3_folder_prefix || "kaizen-backups/")
      }
    } catch (err) {
      console.error("Failed to load cloud storage config:", err)
    } finally {
      setIsLoading(false)
      isInitialLoadDone.current = true
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // Auto-save with debounce
  useEffect(() => {
    if (!isInitialLoadDone.current) return

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveConfig(false)
    }, 500)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    provider,
    enabled,
    autoUpload,
    nextcloudUrl,
    nextcloudUsername,
    nextcloudPassword,
    nextcloudFolderPath,
    s3Endpoint,
    s3Region,
    s3Bucket,
    s3AccessKey,
    s3SecretKey,
    s3FolderPrefix,
  ])

  // Save config
  const saveConfig = useCallback(
    async (showToast = true) => {
      setIsSaving(true)
      try {
        const newConfig: CloudStorageConfig = {
          ...config,
          provider,
          enabled,
          auto_upload: autoUpload,
          nextcloud_url: nextcloudUrl || null,
          nextcloud_username: nextcloudUsername || null,
          nextcloud_password: nextcloudPassword || null,
          nextcloud_folder_path: nextcloudFolderPath || null,
          s3_endpoint: s3Endpoint || null,
          s3_region: s3Region || null,
          s3_bucket: s3Bucket || null,
          s3_access_key: s3AccessKey || null,
          s3_secret_key: s3SecretKey || null,
          s3_folder_prefix: s3FolderPrefix || null,
        }

        await invoke("save_cloud_storage_config", { config: newConfig })
        setConfig(newConfig)
        if (showToast) {
          toast.success(t("cloudStorage.configSaved"))
        }
      } catch (err) {
        console.error("Failed to save config:", err)
        if (showToast) {
          toast.error(t("cloudStorage.saveFailed"))
        }
      } finally {
        setIsSaving(false)
      }
    },
    [
      config,
      provider,
      enabled,
      autoUpload,
      nextcloudUrl,
      nextcloudUsername,
      nextcloudPassword,
      nextcloudFolderPath,
      s3Endpoint,
      s3Region,
      s3Bucket,
      s3AccessKey,
      s3SecretKey,
      s3FolderPrefix,
    ]
  )

  // Test connection
  const testConnection = useCallback(async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      // Save first to ensure config is up to date
      await saveConfig(false)

      const result = await invoke<ConnectionTestResult>("test_cloud_connection")
      setTestResult(result)
      if (result.success) {
        toast.success(t("cloudStorage.connectionSuccess"))
      } else {
        toast.error(result.message)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setTestResult({ success: false, message, storage_used: null, storage_total: null })
      toast.error(message)
    } finally {
      setIsTesting(false)
    }
  }, [saveConfig])

  // Format bytes
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  // Check if provider is configured
  const isProviderConfigured = (): boolean => {
    switch (provider) {
      case "nextcloud":
        return !!(nextcloudUrl && nextcloudUsername && nextcloudPassword)
      case "google_drive":
        return !!config.google_access_token
      case "s3":
        return !!(s3Endpoint && s3Bucket && s3AccessKey && s3SecretKey)
      case "dropbox":
        return !!config.dropbox_access_token
      default:
        return false
    }
  }

  // Complete Google OAuth flow (poll for token)
  const completeGoogleOAuth = useCallback(async (deviceCodeResponse: DeviceCodeResponse) => {
    try {
      await invoke("cloud_oauth_complete_google", {
        deviceCode: deviceCodeResponse.device_code,
        interval: deviceCodeResponse.interval,
        expiresIn: deviceCodeResponse.expires_in,
      })
      toast.success(t("cloudStorage.connectedToGoogleDrive"))
      setDeviceCode(null)
      // Reload config to get the new tokens
      await loadConfig()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setAuthError(message)
      toast.error(message)
    } finally {
      setIsAuthenticating(false)
    }
  }, [loadConfig])

  // Start Google OAuth flow
  const startGoogleOAuth = useCallback(async () => {
    setIsAuthenticating(true)
    setAuthError(null)
    setDeviceCode(null)
    try {
      const response = await invoke<DeviceCodeResponse>("cloud_oauth_start_google")
      setDeviceCode(response)
      // Open verification URL in browser
      try {
        await openUrl(response.verification_uri)
      } catch {
        // If opener plugin not available, user will need to open manually
      }
      // Start polling for completion
      completeGoogleOAuth(response)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setAuthError(message)
      setIsAuthenticating(false)
      toast.error(message)
    }
  }, [completeGoogleOAuth])

  // Disconnect Google Drive
  const disconnectGoogle = useCallback(async () => {
    try {
      const newConfig: CloudStorageConfig = {
        ...config,
        google_access_token: null,
        google_refresh_token: null,
        google_expires_at: null,
        google_folder_id: null,
      }
      await invoke("save_cloud_storage_config", { config: newConfig })
      setConfig(newConfig)
      toast.success(t("cloudStorage.disconnectedFromGoogleDrive"))
    } catch (err) {
      console.error("Failed to disconnect:", err)
    }
  }, [config])

  // Complete Dropbox OAuth flow (after user enters code)
  const completeDropboxOAuth = useCallback(async (code: string) => {
    setIsAuthenticating(true)
    try {
      await invoke("cloud_oauth_complete_dropbox", {
        authorizationCode: code,
      })
      toast.success(t("cloudStorage.connectedToDropbox"))
      setDeviceCode(null)
      // Reload config to get the new tokens
      await loadConfig()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setAuthError(message)
      toast.error(message)
    } finally {
      setIsAuthenticating(false)
    }
  }, [loadConfig])

  // Start Dropbox OAuth flow
  const startDropboxOAuth = useCallback(async () => {
    setIsAuthenticating(true)
    setAuthError(null)
    setDeviceCode(null)
    try {
      const response = await invoke<DeviceCodeResponse>("cloud_oauth_start_dropbox")
      setDeviceCode(response)
      setIsAuthenticating(false) // User needs to enter code manually
      // Open verification URL in browser
      try {
        await openUrl(response.verification_uri)
      } catch {
        // If opener plugin not available, user will need to open manually
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setAuthError(message)
      setIsAuthenticating(false)
      toast.error(message)
    }
  }, [])

  // Disconnect Dropbox
  const disconnectDropbox = useCallback(async () => {
    try {
      const newConfig: CloudStorageConfig = {
        ...config,
        dropbox_access_token: null,
        dropbox_refresh_token: null,
        dropbox_expires_at: null,
      }
      await invoke("save_cloud_storage_config", { config: newConfig })
      setConfig(newConfig)
      toast.success(t("cloudStorage.disconnectedFromDropbox"))
    } catch (err) {
      console.error("Failed to disconnect:", err)
    }
  }, [config])

  // Copy user code to clipboard
  const copyUserCode = useCallback(async () => {
    if (deviceCode?.user_code) {
      await navigator.clipboard.writeText(deviceCode.user_code)
      toast.success(t("cloudStorage.codeCopied"))
    }
  }, [deviceCode?.user_code])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-medium">{t("cloudStorage.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("cloudStorage.description")}</p>
      </div>

      {/* Provider Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("cloudStorage.provider")}</CardTitle>
          <CardDescription>{t("cloudStorage.providerDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            value={provider}
            onValueChange={(value) => setProvider(value as CloudProvider)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nextcloud">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  {t("cloudStorage.nextcloud")}
                </div>
              </SelectItem>
              <SelectItem value="google_drive">
                <div className="flex items-center gap-2">
                  <Cloud className="h-4 w-4" />
                  {t("cloudStorage.googleDrive")}
                </div>
              </SelectItem>
              <SelectItem value="s3">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  {t("cloudStorage.s3")}
                </div>
              </SelectItem>
              <SelectItem value="dropbox">
                <div className="flex items-center gap-2">
                  <Cloud className="h-4 w-4" />
                  {t("cloudStorage.dropbox")}
                </div>
              </SelectItem>
            </SelectContent>
          </Select>

          {/* Enable/Disable */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t("cloudStorage.enabled")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("cloudStorage.enabledDesc")}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Auto-upload */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t("cloudStorage.autoUpload")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("cloudStorage.autoUploadDesc")}
              </p>
            </div>
            <Switch checked={autoUpload} onCheckedChange={setAutoUpload} />
          </div>
        </CardContent>
      </Card>

      {/* Provider-specific configuration */}
      {provider === "nextcloud" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4" />
              {t("cloudStorage.nextcloudConfig")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("cloudStorage.nextcloudUrl")}</Label>
              <Input
                placeholder="https://cloud.example.com"
                value={nextcloudUrl}
                onChange={(e) => setNextcloudUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("cloudStorage.username")}</Label>
              <Input
                value={nextcloudUsername}
                onChange={(e) => setNextcloudUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("cloudStorage.password")}</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={nextcloudPassword}
                  onChange={(e) => setNextcloudPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("cloudStorage.folderPath")}</Label>
              <Input
                placeholder="/Kaizen Backups"
                value={nextcloudFolderPath}
                onChange={(e) => setNextcloudFolderPath(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {provider === "s3" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              {t("cloudStorage.s3Config")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("cloudStorage.s3Endpoint")}</Label>
              <Input
                placeholder="https://s3.amazonaws.com"
                value={s3Endpoint}
                onChange={(e) => setS3Endpoint(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("cloudStorage.s3Region")}</Label>
                <Input
                  placeholder="us-east-1"
                  value={s3Region}
                  onChange={(e) => setS3Region(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("cloudStorage.s3Bucket")}</Label>
                <Input
                  placeholder="my-bucket"
                  value={s3Bucket}
                  onChange={(e) => setS3Bucket(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("cloudStorage.s3AccessKey")}</Label>
              <Input
                value={s3AccessKey}
                onChange={(e) => setS3AccessKey(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("cloudStorage.s3SecretKey")}</Label>
              <div className="relative">
                <Input
                  type={showS3Secret ? "text" : "password"}
                  value={s3SecretKey}
                  onChange={(e) => setS3SecretKey(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowS3Secret(!showS3Secret)}
                >
                  {showS3Secret ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("cloudStorage.s3Prefix")}</Label>
              <Input
                placeholder="kaizen-backups/"
                value={s3FolderPrefix}
                onChange={(e) => setS3FolderPrefix(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {provider === "google_drive" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Cloud className="h-4 w-4" />
              Google Drive
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {config.google_access_token ? (
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="bg-green-500/10 text-green-500">
                  <Check className="h-3 w-3 mr-1" />
                  {t("cloudStorage.connected")}
                </Badge>
                <Button variant="outline" size="sm" onClick={disconnectGoogle}>
                  <LogOut className="h-4 w-4 mr-1" />
                  {t("cloudStorage.disconnect")}
                </Button>
              </div>
            ) : oauthAvailability.google_drive ? (
              <div className="space-y-4">
                {deviceCode && provider === "google_drive" ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {t("cloudStorage.googleDriveCodeInstructions")}
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 bg-muted rounded-md text-center font-mono text-lg">
                        {deviceCode.user_code}
                      </code>
                      <Button variant="outline" size="icon" onClick={copyUserCode}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => openUrl(deviceCode.verification_uri)}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      {deviceCode.verification_uri}
                    </Button>
                    {isAuthenticating && (
                      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("cloudStorage.googleDriveWaitingAuth")}
                      </div>
                    )}
                  </div>
                ) : (
                  <Button
                    onClick={startGoogleOAuth}
                    disabled={isAuthenticating}
                    className="w-full"
                  >
                    {isAuthenticating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Cloud className="h-4 w-4 mr-2" />
                    )}
                    {t("cloudStorage.googleDriveSignIn")}
                  </Button>
                )}
                {authError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{authError}</AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {t("cloudStorage.googleDriveNotConfigured")}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {provider === "dropbox" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Cloud className="h-4 w-4" />
              Dropbox
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {config.dropbox_access_token ? (
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="bg-green-500/10 text-green-500">
                  <Check className="h-3 w-3 mr-1" />
                  {t("cloudStorage.connected")}
                </Badge>
                <Button variant="outline" size="sm" onClick={disconnectDropbox}>
                  <LogOut className="h-4 w-4 mr-1" />
                  {t("cloudStorage.disconnect")}
                </Button>
              </div>
            ) : oauthAvailability.dropbox ? (
              <div className="space-y-4">
                {deviceCode && provider === "dropbox" ? (
                  <DropboxCodeEntry
                    deviceCode={deviceCode}
                    onSubmit={completeDropboxOAuth}
                    isAuthenticating={isAuthenticating}
                  />
                ) : (
                  <Button
                    onClick={startDropboxOAuth}
                    disabled={isAuthenticating}
                    className="w-full"
                  >
                    {isAuthenticating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Cloud className="h-4 w-4 mr-2" />
                    )}
                    {t("cloudStorage.dropboxSignIn")}
                  </Button>
                )}
                {authError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{authError}</AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {t("cloudStorage.dropboxNotConfigured")}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Connection test */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("cloudStorage.testConnection")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={testConnection}
            disabled={isTesting || !isProviderConfigured()}
            className="w-full"
          >
            {isTesting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("cloudStorage.testing")}
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("cloudStorage.testConnection")}
              </>
            )}
          </Button>

          {testResult && (
            <Alert variant={testResult.success ? "default" : "destructive"}>
              {testResult.success ? (
                <Check className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertDescription>
                {testResult.message}
                {testResult.success &&
                  testResult.storage_used !== null &&
                  testResult.storage_total !== null && (
                    <div className="mt-2 text-xs">
                      {t("cloudStorage.storageUsed")}: {formatBytes(testResult.storage_used)}{" "}
                      / {formatBytes(testResult.storage_total)}
                    </div>
                  )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Save indicator */}
      {isSaving && (
        <div className="fixed bottom-4 right-4 bg-background border rounded-lg px-3 py-2 shadow-lg flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">{t("cloudStorage.saving")}</span>
        </div>
      )}
    </div>
  )
}
