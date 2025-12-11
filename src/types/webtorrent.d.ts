// Minimal type declaration for webtorrent module
// WebTorrent is lazy-loaded, so we just need to declare it exists
declare module "webtorrent" {
  const WebTorrent: unknown
  export default WebTorrent
}
