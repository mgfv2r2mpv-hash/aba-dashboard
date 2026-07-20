// Static resting state of the cold-launch splash. The animated entrance
// (icon drops from the top, wordmark rises from the bottom, meeting in the
// middle) plays in public/index.html the moment the WebView paints — by the
// time React mounts, the entrance is done, so this mirrors that final frame on
// the same dark-slate background. Keeping every launch layer (#333f45) in sync
// means the storyboard -> HTML splash -> React -> LockScreen hand-off never
// shows a black frame. Shown on native while we decide whether to lock.
export default function LaunchSplash() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        backgroundColor: '#333f45',
      }}
    >
      <img
        src="/launch-icon.svg"
        alt=""
        width={120}
        height={120}
        style={{
          width: 120,
          height: 120,
          borderRadius: 26,
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.28)',
        }}
      />
      <div
        style={{
          fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 0.5,
          color: '#eef0da',
        }}
      >
        SAssi Calendar
      </div>
    </div>
  );
}
