import { framer } from "framer-plugin"
import type { PluginHost, HostMessage } from "@insta2figma/plugin-ui"

const API = "https://insta2figma-production.up.railway.app"
const TOKEN_KEY = "insta2figma:token:v1"

// ─── Layout helpers (mirrors apps/figma-plugin/src/code.ts) ──────────────────

type SignedAsset = { url?: string; storageKey?: string }

function parseThumbSlug(storageKey: string): { postKey: string; slot: number } | null {
  const match = storageKey.match(/\/thumbs\/([^/]+)\.[a-z0-9]+$/i)
  if (!match) return null
  const slug = match[1]
  const slotMatch = slug.match(/^(.+)_(\d+)$/)
  if (slotMatch) return { postKey: slotMatch[1], slot: parseInt(slotMatch[2], 10) || 0 }
  return { postKey: slug, slot: 0 }
}

function chunkFlat(assets: SignedAsset[], cols: number): SignedAsset[][] {
  const rows: SignedAsset[][] = []
  for (let i = 0; i < assets.length; i += cols) rows.push(assets.slice(i, i + cols))
  return rows
}

function groupIntoPostRows(assets: SignedAsset[]): SignedAsset[][] {
  const order: string[] = []
  const byPost = new Map<string, { asset: SignedAsset; slot: number; seq: number }[]>()
  assets.forEach((asset, seq) => {
    const parsed = asset.storageKey ? parseThumbSlug(asset.storageKey) : null
    const postKey = parsed?.postKey ?? `__row_${seq}`
    const slot = parsed?.slot ?? 0
    if (!byPost.has(postKey)) { order.push(postKey); byPost.set(postKey, []) }
    byPost.get(postKey)!.push({ asset, slot, seq })
  })
  return order.map((k) => {
    const row = byPost.get(k)!
    row.sort((a, b) => a.slot - b.slot || a.seq - b.seq)
    return row.map((r) => r.asset)
  })
}
const HISTORY_KEY = "insta2figma:history:v1"

export class FramerHost implements PluginHost {
  readonly canResize = false
  private handlers = new Set<(msg: HostMessage) => void>()
  private token = localStorage.getItem(TOKEN_KEY) ?? ""

  subscribe(handler: (msg: HostMessage) => void): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  send(msg: HostMessage): void {
    void this.dispatch(msg)
  }

  private emit(msg: HostMessage): void {
    this.handlers.forEach((h) => h(msg))
  }

  private auth(): Record<string, string> {
    return { authorization: `Bearer ${this.token}` }
  }

  private setToken(t: string): void {
    this.token = t
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  }

  private async dispatch(msg: HostMessage): Promise<void> {
    switch (msg.type) {
      case "session-request":
        await this.handleSessionRequest()
        break
      case "history-request":
        this.handleHistoryRequest()
        break
      case "history-save":
        this.handleHistorySave(msg)
        break
      case "open-external":
        window.open(String(msg.url ?? ""), "_blank")
        break
      case "billing-checkout":
        await this.handleBillingCheckout(msg)
        break
      case "billing-portal":
        await this.handleBillingPortal()
        break
      case "auth-logout":
        this.handleLogout()
        break
      case "auth-magic-link":
        await this.handleMagicLink(msg)
        break
      case "auth-google":
        await this.handleGoogleAuth()
        break
      case "profile-preview":
        await this.handleProfilePreview(msg)
        break
      case "import-profile":
        await this.handleImport(msg)
        break
      case "cancel":
      case "ui-resize":
        break // noop in Framer
    }
  }

  // ─── Session ──────────────────────────────────────────────────────────────

  private async handleSessionRequest(): Promise<void> {
    if (!this.token) {
      // No token — emit a guest free-tier session so the UI works without login.
      this.emit({
        type: "session-data",
        planTier: "free",
        userId: null,
        quotas: {
          imagesRemaining: null,
          imagesLimit: null,
          maxPosts: 12,
          maxImagesPerJob: 24,
          expandCarouselImages: false,
          periodEnd: null,
        },
      })
      return
    }
    try {
      const res = await fetch(`${API}/v1/me`, { headers: this.auth() })
      const body = await res.json()
      if (res.status === 401) {
        this.setToken("")
        this.emit({ type: "show-login" })
        return
      }
      if (!res.ok) throw new Error(`GET /me ${res.status}`)
      this.emit({ type: "session-data", ...body.data })
    } catch (e) {
      this.emit({ type: "session-error", message: String(e) })
    }
  }

  // ─── History ──────────────────────────────────────────────────────────────

  private handleHistoryRequest(): void {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      const entries = raw ? (JSON.parse(raw) as unknown) : []
      this.emit({ type: "history-data", entries })
    } catch {
      this.emit({ type: "history-data", entries: [] })
    }
  }

  private handleHistorySave(msg: HostMessage): void {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(msg.entries ?? []))
    } catch (e) {
      console.warn("[Insta2Figma] history-save", e)
    }
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  private handleLogout(): void {
    this.setToken("")
    this.emit({
      type: "session-data",
      planTier: "free",
      userId: null,
      quotas: {
        imagesRemaining: null,
        imagesLimit: null,
        maxPosts: 12,
        maxImagesPerJob: 24,
        expandCarouselImages: false,
        periodEnd: null,
      },
    })
    this.emit({ type: "show-login", dismissable: true })
  }

  private async handleMagicLink(msg: HostMessage): Promise<void> {
    const email = String(msg.email ?? "").trim()
    this.emit({ type: "login-loading" })
    try {
      const res = await fetch(`${API}/v1/auth/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const body = await res.json()
      if (!res.ok || !body.data?.pollingId) {
        throw new Error(
          body.message ?? body.error?.message ?? "Failed to send magic link.",
        )
      }
      this.emit({ type: "login-email-sent", email })
      const { jwt } = await this.pollAuthUntilDone(String(body.data.pollingId))
      this.setToken(jwt)
      const meRes = await fetch(`${API}/v1/me`, {
        headers: { authorization: `Bearer ${jwt}` },
      })
      const meBody = await meRes.json()
      this.emit({ type: "session-data", ...meBody.data })
      this.emit({ type: "login-done" })
    } catch (e) {
      this.emit({ type: "login-error", message: String(e) })
    }
  }

  private async handleGoogleAuth(): Promise<void> {
    try {
      const res = await fetch(`${API}/v1/auth/google/start`)
      const body = await res.json()
      if (!res.ok || !body.data?.url || !body.data?.pollingId) {
        throw new Error("Google sign-in not available.")
      }
      window.open(String(body.data.url), "_blank")
      this.emit({ type: "login-google-pending" })
      const { jwt } = await this.pollAuthUntilDone(String(body.data.pollingId))
      this.setToken(jwt)
      const meRes = await fetch(`${API}/v1/me`, {
        headers: { authorization: `Bearer ${jwt}` },
      })
      const meBody = await meRes.json()
      this.emit({ type: "session-data", ...meBody.data })
      this.emit({ type: "login-done" })
    } catch (e) {
      this.emit({ type: "login-error", message: String(e) })
    }
  }

  private async pollAuthUntilDone(pollingId: string): Promise<{ jwt: string }> {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      try {
        const res = await fetch(`${API}/v1/auth/poll?pollingId=${pollingId}`)
        const body = await res.json()
        const data = body.data
        if (data?.status === "done" && typeof data.jwt === "string") {
          return { jwt: data.jwt }
        }
      } catch {
        // network blip — keep trying
      }
    }
    throw new Error("Sign-in timed out. Please try again.")
  }

  // ─── Billing ──────────────────────────────────────────────────────────────

  private async handleBillingCheckout(msg: HostMessage): Promise<void> {
    try {
      const res = await fetch(`${API}/v1/billing/checkout-session`, {
        method: "POST",
        headers: { ...this.auth(), "content-type": "application/json" },
        body: JSON.stringify({
          plan: msg.plan ?? "pro",
          cycle: msg.cycle ?? "monthly",
        }),
      })
      const body = await res.json()
      if (!res.ok || !body.data?.url) throw new Error(`Checkout ${res.status}`)
      window.open(String(body.data.url), "_blank")
      void this.longPollForPlanChange()
    } catch (e) {
      console.error("[Insta2Figma] billing-checkout", e)
    }
  }

  private async handleBillingPortal(): Promise<void> {
    try {
      const res = await fetch(`${API}/v1/billing/portal-session`, {
        method: "POST",
        headers: this.auth(),
      })
      const body = await res.json()
      if (!res.ok || !body.data?.url) throw new Error(`Portal ${res.status}`)
      window.open(String(body.data.url), "_blank")
      void this.longPollForPlanChange()
    } catch (e) {
      console.error("[Insta2Figma] billing-portal", e)
    }
  }

  private async longPollForPlanChange(): Promise<void> {
    try {
      const meRes = await fetch(`${API}/v1/me`, { headers: this.auth() })
      const meBody = await meRes.json()
      const currentTier = String(meBody.data?.planTier ?? "free")
      const deadline = Date.now() + 5 * 60_000
      while (Date.now() < deadline) {
        const res = await fetch(
          `${API}/v1/me/plan-events?currentTier=${encodeURIComponent(currentTier)}`,
          { headers: this.auth() },
        )
        const body = await res.json()
        if (res.ok && body.data?.changed === true) {
          this.emit({ type: "session-data", ...body.data })
          return
        }
      }
    } catch (e) {
      console.warn("[Insta2Figma] longPollForPlanChange", e)
    }
  }

  // ─── Preview ──────────────────────────────────────────────────────────────

  private async handleProfilePreview(msg: HostMessage): Promise<void> {
    const username = String(msg.username ?? "")
      .trim()
      .replace(/^@+/, "")
    const requestId = Number(msg.requestId ?? 0)
    const requestKind = msg.requestKind === "page" ? "page" : "initial"

    if (!username) {
      this.emit({
        type: "profile-preview-error",
        requestId,
        message: "Enter a username.",
      })
      return
    }

    try {
      const qs = this.buildPreviewQS(username, msg)
      const previewHeaders: Record<string, string> = {}
      if (this.token) previewHeaders.authorization = `Bearer ${this.token}`
      const res = await fetch(`${API}/v1/instagram/profile-preview?${qs}`, {
        headers: previewHeaders,
      })
      const payload = await res.json()
      const data = payload.data as Record<string, unknown> | undefined

      if (!res.ok || !data) {
        const errMsg =
          typeof payload.message === "string"
            ? payload.message
            : res.status === 503
              ? "Ops...our machines are almost exploding. Wait about a minute and try again."
              : "Could not load profile preview."
        this.emit({
          type: "profile-preview-error",
          requestKind,
          requestId,
          message: errMsg,
        })
        return
      }

      const rawPosts = Array.isArray(data.postsPreview) ? data.postsPreview : []
      const postsPreview = (rawPosts as Record<string, unknown>[]).map((p) => ({
        index: p.index,
        shortcode: p.shortcode,
        isVideo: p.isVideo,
        carouselCount: p.carouselCount,
        thumbnailUrl: null,
      }))

      const profilePicUrlHd =
        typeof data.profilePicDataUrl === "string"
          ? data.profilePicDataUrl
          : typeof data.profilePicUrlHd === "string"
            ? `${API}/v1/instagram/image?url=${encodeURIComponent(data.profilePicUrlHd)}`
            : undefined

      this.emit({
        type: "profile-preview-data",
        requestKind,
        requestId,
        username: data.username,
        mediaCount: data.mediaCount,
        isPrivate: data.isPrivate,
        imageCount: data.imageCount,
        estimatedImportImages: data.estimatedImportImages,
        estimatedPostCovers: data.estimatedPostCovers,
        estimatedCarouselExtras: data.estimatedCarouselExtras,
        postsPreview,
        postsAvailable: data.postsAvailable,
        selectionWarning: data.selectionWarning,
        previewTotalPages: data.previewTotalPages,
        nextPreviewCursor: data.nextPreviewCursor,
        instagramUserId: data.instagramUserId,
        thumbsPending: rawPosts.length,
        ...(profilePicUrlHd ? { profilePicUrlHd } : {}),
      })

      for (const p of rawPosts as Record<string, unknown>[]) {
        const url = p.thumbnailUrl
        if (typeof url === "string" && url.length > 0) {
          const proxied =
            url.startsWith("data:") || url.startsWith("blob:")
              ? url
              : `${API}/v1/instagram/image?url=${encodeURIComponent(url)}`
          this.emit({
            type: "profile-preview-thumb",
            requestKind,
            requestId,
            shortcode: p.shortcode,
            thumbnailUrl: proxied,
          })
        }
      }
      if (rawPosts.length > 0) {
        this.emit({ type: "profile-preview-thumbs-done", requestKind, requestId })
      }
    } catch (e) {
      this.emit({
        type: "profile-preview-error",
        requestKind,
        requestId,
        message: String(e),
      })
    }
  }

  private buildPreviewQS(username: string, opts: HostMessage): string {
    const parts = [
      `username=${encodeURIComponent(username)}`,
      `maxPosts=${opts.maxPosts ?? 12}`,
      `expandCarouselImages=${opts.expandCarouselImages ? "true" : "false"}`,
    ]
    if (opts.selectionMode) parts.push(`selectionMode=${opts.selectionMode}`)
    if (opts.startIndex != null) parts.push(`startIndex=${opts.startIndex}`)
    if (opts.postCount != null) parts.push(`postCount=${opts.postCount}`)
    if (opts.timelineOrder) parts.push(`timelineOrder=${opts.timelineOrder}`)
    if (opts.previewListSize != null)
      parts.push(`previewListSize=${opts.previewListSize}`)
    if (Array.isArray(opts.selectedIndices) && opts.selectedIndices.length) {
      parts.push(
        `selectedIndices=${(opts.selectedIndices as number[]).join(",")}`,
      )
    }
    if (opts.previewPage != null) parts.push(`previewPage=${opts.previewPage}`)
    if (opts.after)
      parts.push(`after=${encodeURIComponent(String(opts.after))}`)
    if (opts.userId)
      parts.push(`userId=${encodeURIComponent(String(opts.userId))}`)
    return parts.join("&")
  }

  // ─── Import ───────────────────────────────────────────────────────────────

  private async handleImport(msg: HostMessage): Promise<void> {
    const username = String(msg.username ?? "")
      .trim()
      .replace(/^@+/, "")
    if (!username) {
      this.emit({ type: "import-error", message: "Enter a username." })
      return
    }
    if (!this.token) {
      this.emit({ type: "show-login", dismissable: true })
      return
    }

    try {
      this.emit({ type: "import-status", text: "Adding to queue…" })

      const idem = `framer-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const jr = await fetch(`${API}/v1/jobs`, {
        method: "POST",
        headers: {
          ...this.auth(),
          "content-type": "application/json",
          "idempotency-key": idem,
        },
        body: JSON.stringify({
          type: "SCRAPE_PROFILE",
          input: {
            username,
            maxPosts: Number(msg.maxPosts ?? 8),
            expandCarouselImages: msg.expandCarouselImages === true,
            ...(msg.selectionMode ? { selectionMode: msg.selectionMode } : {}),
            ...(msg.startIndex != null ? { startIndex: msg.startIndex } : {}),
            ...(msg.postCount != null ? { postCount: msg.postCount } : {}),
            ...(msg.timelineOrder ? { timelineOrder: msg.timelineOrder } : {}),
            ...(Array.isArray(msg.selectedIndices) &&
            msg.selectedIndices.length
              ? { selectedIndices: msg.selectedIndices }
              : {}),
            ...(msg.estimatedImportImages != null
              ? {
                  estimatedImportImages: Math.floor(
                    Number(msg.estimatedImportImages),
                  ),
                }
              : {}),
          },
        }),
      })

      const jobBody = await jr.json()
      if (!jr.ok) {
        const err = jobBody.error as { code?: string; message?: string } | undefined
        if (err?.code === "QUOTA_EXCEEDED") {
          throw new Error(
            err.message ?? "Monthly quota used up. Upgrade to Pro to continue.",
          )
        }
        throw new Error("Could not start the import. Try again in a moment.")
      }
      const jobId = jobBody.data?.id
      if (!jobId)
        throw new Error("Could not start the import. Try again in a moment.")

      // Poll for completion
      let signedAssets: { url?: string; storageKey?: string }[] = []
      let status = ""

      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        this.emit({ type: "import-status", text: `Processing… (${i + 1})` })
        const gr = await fetch(
          `${API}/v1/jobs/${encodeURIComponent(jobId)}`,
          { headers: this.auth() },
        )
        const gj = await gr.json()
        const gData = gj.data as Record<string, unknown> | undefined
        if (!gr.ok)
          throw new Error("Could not check import progress. Try again.")
        status = String(gData?.status ?? "")
        if (status === "succeeded") {
          if (Array.isArray(gData?.signedAssets)) signedAssets = gData.signedAssets as typeof signedAssets
          break
        }
        if (status === "failed")
          throw new Error("Import did not finish. Try again in a moment.")
      }

      if (status !== "succeeded")
        throw new Error("Import is taking longer than expected.")

      const imageAssets = signedAssets
        .filter(
          (a) =>
            typeof a.storageKey === "string"
              ? !/\/profile\.[a-z0-9]+$/i.test(a.storageKey)
              : true,
        )
        .filter((a) => !!a.url)

      if (imageAssets.length === 0)
        throw new Error("No images came back from the import.")

      this.emit({
        type: "import-status",
        text: `Placing ${imageAssets.length} images…`,
      })

      if (!framer.isAllowedTo("addImage") || !framer.isAllowedTo("createFrameNode")) {
        throw new Error(
          "Framer permissions required. Accept the prompts and try again.",
        )
      }

      // 1. Fetch all in parallel
      this.emit({ type: "import-status", text: `Downloading ${imageAssets.length} images…` })
      const files = await Promise.all(
        imageAssets.map(async (asset, i) => {
          const res = await fetch(asset.url!)
          const blob = await res.blob()
          return new File([blob], `@${username}-${i + 1}.jpg`, { type: blob.type })
        }),
      )

      // 2. Upload to Framer in parallel → ImageAsset[]
      this.emit({ type: "import-status", text: `Uploading ${files.length} images…` })
      const uploaded = await Promise.all(files.map((f) => framer.uploadImage(f)))

      // 3. Measure dimensions in parallel
      const sizes = await Promise.all(uploaded.map((img) => img.measure()))

      // 4. Calculate grid layout manually (mirrors Figma plugin behaviour)
      const COL_WIDTH = 280
      const GAP = 8
      const ROW_GAP = 8
      const COLS = 3

      // Stack layout: outer frame (vertical) → row frames (horizontal) → image frames
      // Avoids manual pin positioning which Framer interprets inconsistently.
      const expandCarousel = msg.expandCarouselImages === true
      const layoutRows: SignedAsset[][] = expandCarousel
        ? groupIntoPostRows(imageAssets)
        : chunkFlat(imageAssets, COLS)

      const assetToUploaded = new Map(imageAssets.map((a, i) => [a, uploaded[i]]))
      const assetToSize = new Map(imageAssets.map((a, i) => [a, sizes[i]]))

      // 5. Outer container: vertical stack
      const parent = await framer.createFrameNode({
        name: `@${username}`,
        layout: "stack",
        stackDirection: "vertical",
        gap: `${ROW_GAP}px`,
        width: `${COLS * COL_WIDTH + (COLS - 1) * GAP}px`,
      })
      if (!parent) throw new Error("Could not create frame on canvas.")

      // 6. For each row: create a horizontal-stack row frame, then image frames inside it
      let globalIdx = 0
      for (const row of layoutRows) {
        const rowFrame = await framer.createFrameNode(
          { layout: "stack", stackDirection: "horizontal", gap: `${GAP}px` },
          parent.id,
        )
        if (!rowFrame) continue
        await Promise.all(
          row.map((asset) => {
            const uploadedAsset = assetToUploaded.get(asset)!
            const { width: imgW, height: imgH } = assetToSize.get(asset) ?? { width: 1, height: 1 }
            const h = imgW > 0 ? Math.round(COL_WIDTH * (imgH / imgW)) : COL_WIDTH
            return framer.createFrameNode(
              {
                name: `@${username} - #${++globalIdx}`,
                backgroundImage: uploadedAsset,
                width: `${COL_WIDTH}px`,
                height: `${h}px`,
              },
              rowFrame.id,
            )
          }),
        )
      }

      const profileAsset = signedAssets.find(
        (a) =>
          typeof a.storageKey === "string" &&
          /\/profile\.[a-z0-9]+$/i.test(a.storageKey),
      )

      this.emit({
        type: "import-done",
        placed: files.length,
        total: imageAssets.length,
        error: false,
        ...(profileAsset?.url ? { profilePicUrl: profileAsset.url } : {}),
      })
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e)
      console.error("[Insta2Figma] import", e)
      this.emit({ type: "import-error", message: text })
    }
  }
}
