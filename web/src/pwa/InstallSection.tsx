/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The "Install" block of the Android TV Remote settings screen. Offers a real install
 * button when Chromium has fired `beforeinstallprompt`, Share-sheet instructions on iOS
 * where that event does not exist, and — when the appliance is reached over an insecure
 * origin such as `http://192.168.1.209:7433`, where no browser will install it however
 * good the manifest is — a link to the public HTTPS origin the operator configured via
 * PUBLIC_URL. When no such origin is configured the whole section renders nothing, because
 * "you cannot install this" is not something the reader can act on. Never renders a button
 * that would do nothing when clicked.
 */
import { useState, useSyncExternalStore } from 'react'
import { CheckCircle2, Download, Lock, Share } from 'lucide-react'

import { Btn } from '@/components/ui'
import { getInstallState, getPublicUrl, install, subscribe } from '@/pwa/runtime'

/**
 * The settings block that installs the remote to the home screen.
 *
 * Renders as a card, so it sits alongside the other panels on the settings and landing
 * screens without any wrapper of its own — it returns null when there is nothing to offer,
 * and an outer wrapper would leave an empty card behind.
 */
export function InstallSection() {
  const state = useSyncExternalStore(subscribe, getInstallState)
  const publicUrl = useSyncExternalStore(subscribe, getPublicUrl)
  const [dismissed, setDismissed] = useState(false)

  // Nothing installable and nowhere to send them: say nothing rather than explaining a
  // dead end the reader cannot do anything about.
  if (state === 'unconfigured') return null

  return (
    <section className="bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-sm sm:p-5">
      <h2 className="text-base font-semibold">Install</h2>

      {state === 'ready' && (
        <>
          <p className="text-muted-foreground text-sm">
            Add the remote to your home screen. It opens full screen, with no browser
            chrome, like a native app.
          </p>
          <div className="flex items-center gap-3">
            <Btn onClick={() => void install().then((o) => setDismissed(o === 'dismissed'))}>
              <Download aria-hidden className="size-4" />
              Install app
            </Btn>
            <span aria-live="polite" className="text-muted-foreground text-xs">
              {dismissed && 'Not installed. You can try again from your browser menu.'}
            </span>
          </div>
        </>
      )}

      {state === 'installed' && (
        <div className="bg-online/10 text-online flex items-start gap-3 rounded-xl p-3 text-sm">
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p>Installed. You are running the remote as an app.</p>
        </div>
      )}

      {state === 'ios' && (
        <div className="bg-secondary flex items-start gap-3 rounded-xl p-3 text-sm">
          <Share aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div className="flex flex-col gap-1">
            <p>iPhone and iPad have no install button. Add it by hand:</p>
            <ol className="text-muted-foreground list-decimal pl-4">
              <li>Tap Share at the bottom of Safari.</li>
              <li>Scroll down and tap Add to Home Screen.</li>
              <li>Tap Add.</li>
            </ol>
          </div>
        </div>
      )}

      {state === 'elsewhere' && publicUrl && (
        <div className="bg-secondary flex items-start gap-3 rounded-xl p-3 text-sm">
          <Lock aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div className="flex flex-col gap-2">
            <p>
              This page is served over plain HTTP, so your browser will not install it.
              Open the remote over HTTPS and install it from there.
            </p>
            <a
              className="text-foreground font-medium underline underline-offset-4"
              href={`${publicUrl}/settings`}
              rel="noreferrer"
            >
              {publicUrl}
            </a>
          </div>
        </div>
      )}

      {state === 'unavailable' && (
        <p className="text-muted-foreground text-sm">
          This browser has not offered to install the remote. Chrome and Edge on Android
          and desktop support it; Firefox and desktop Safari do not.
        </p>
      )}
    </section>
  )
}
