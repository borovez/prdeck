/**
 * "Open beside": the PR's GitHub page (or the Jira issue) in a separate window on the right half of the screen. While it
 * stays open it follows the PR or issue shown in the panel. (GitHub and Jira can't be embedded in a frame.)
 */
let win: Window | null = null

export const besideOpen = () => !!win && !win.closed

export function openBeside(url: string) {
  const w = Math.round(screen.availWidth / 2)
  const features = `popup,width=${w},height=${screen.availHeight},left=${screen.availWidth - w},top=0`
  if (besideOpen()) {
    win!.location.href = url
    win!.focus()
  } else {
    win = window.open(url, 'prdeck-beside', features)
  }
}

/** Navigate the beside window, if it's open, without stealing focus */
export function followBeside(url: string) {
  if (besideOpen()) win!.location.href = url
}
