/** Pre-programmed import status copy — main thread only. Numbers allowed; no IDs or codes. */

const AUTH = [
  'Checking your session…',
  'Making sure you are still logged in…',
  'One sec — verifying access…',
] as const;

const QUEUE = [
  'Warming up the import engine…',
  'Telling the server what to fetch…',
  'Packaging your request…',
] as const;

const WAITING = [
  'Scrolling through Instagram…',
  'Collecting posts — hang tight…',
  'Still working — good things take time…',
  'Fetching images from the feed…',
  'Almost there… probably…',
  'Crunching pixels in the background…',
  'The feed is deep — still digging…',
  'Patience — beauty takes a moment…',
] as const;

const SIGNING = [
  'Preparing your download links…',
  'Getting your images ready…',
  'Wrapping up the files…',
] as const;

const AVATAR = [
  'Saving profile photo for history…',
  'Grabbing the profile pic…',
  'Stashing the avatar for next time…',
] as const;

function pick(pool: readonly string[], index: number): string {
  const i = ((index % pool.length) + pool.length) % pool.length;
  return pool[i]!;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function importStatusAuth(): string {
  return AUTH[0]!;
}

export function importStatusQueue(index = 0): string {
  return pick(QUEUE, index);
}

/** Rotating “thinking” line while the scrape job runs. */
export function importStatusWaiting(attempt: number): string {
  return pick(WAITING, attempt);
}

export function importStatusPostsFound(count: number): string {
  return `Found ${count} ${plural(count, 'post', 'posts')} — looking good.`;
}

export function importStatusSigning(index = 0): string {
  return pick(SIGNING, index);
}

export function importStatusPlacing(count: number): string {
  return `Placing ${count} ${plural(count, 'image', 'images')} on the canvas…`;
}

export function importStatusAvatar(index = 0): string {
  return pick(AVATAR, index);
}
