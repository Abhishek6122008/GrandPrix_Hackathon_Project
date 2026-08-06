// Scrub/play control over simulation ticks.
export default function Timeline({ tick = 0, totalTicks = 0, playing = false, onSeek, onTogglePlay }) {
  return (
    <div className="panel" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <button style={{ width: 72 }} onClick={onTogglePlay}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <input
        type="range"
        min="0"
        max={Math.max(totalTicks, tick)}
        value={tick}
        onChange={(e) => onSeek?.(Number(e.target.value))}
      />
      <span style={{ color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
        t {tick} / {totalTicks}
      </span>
    </div>
  );
}
