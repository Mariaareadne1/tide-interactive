// Small line icons, drawn for this UI at 20px on a 20-unit grid.

interface IconProps {
  name: IconName;
}

export type IconName = 'undo' | 'camera' | 'help' | 'menu' | 'close' | 'follow' | 'wave' | 'burrow';

const paths: Record<IconName, string> = {
  undo: 'M7.5 6.5 4 10l3.5 3.5M4.5 10H12a4 4 0 0 1 0 8h-1',
  camera: 'M3.5 7.5h3l1.3-2h4.4l1.3 2h3v8h-13zM10 13.6a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6',
  help: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15M7.9 7.8a2.2 2.2 0 1 1 3 2c-.6.3-.9.8-.9 1.4v.5M10 14.2v.1',
  menu: 'M4.5 10h.1M10 10h.1M15.5 10h.1',
  close: 'M5 5l10 10M15 5 5 15',
  // a wavering line with footprints beside it
  follow: 'M3 13c2.5-4 4.5 2 7-2s4.5 1.5 7-2M5.5 16h.1M9 15h.1M12.5 13.8h.1',
  // two raised claws
  wave: 'M6 15.5V10M14 15.5V10M6 10c-2-.5-2.8-3-1.6-4.8.6 1.6 1.8 2 3 1.6M6 10c1.5-.6 2-2.2 1.4-3.2M14 10c2-.5 2.8-3 1.6-4.8-.6 1.6-1.8 2-3 1.6M14 10c-1.5-.6-2-2.2-1.4-3.2',
  // eyes peeping over a mound of sand
  burrow: 'M2.5 15.5c2-3.2 4.5-4.5 7.5-4.5s5.5 1.3 7.5 4.5M8 11V8M12 11V8M8 7.2h.1M12 7.2h.1',
};

export function Icon({ name }: IconProps) {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d={paths[name]} fill="none" stroke="currentColor" strokeWidth={name === 'menu' ? 2.6 : 1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
