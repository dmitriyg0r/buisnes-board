const paths: Record<string, string> = {
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronUp: 'M6 15l6-6 6 6',
  search: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM16 16l4.5 4.5',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  gridLayout: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  freeLayout: 'M3 5h6v6H3zM15 3h6v6h-6zM5 15h6v6H5zM15 13h6v6h-6z',
  model: 'M4 4h7v6H4zM13 14h7v6h-7zM7.5 10v2a2 2 0 0 0 2 2H13',
  flag: 'M5 21V4M5 4h12l-2.5 4 2.5 4H5',
  pencil: 'M4 20l4-1 11-11-3-3L5 16z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  play: 'M8 5l11 7-11 7z',
  minus: 'M5 12h14',
  hand: 'M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-2.5-3.5a1.5 1.5 0 0 1 2.4-1.8L8 14',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.42 2.46-.08-.02a1.7 1.7 0 0 0-1.8.65l-.05.07h-2.84l-.03-.09a1.7 1.7 0 0 0-1.58-1.1 1.7 1.7 0 0 0-1.58 1.1l-.03.09H7.55l-.05-.07a1.7 1.7 0 0 0-1.8-.65l-.08.02-1.42-2.46.06-.06A1.7 1.7 0 0 0 4.6 15l-.04-.08L3.14 12.5l.07-.06a1.7 1.7 0 0 0 0-1.88l-.07-.06 1.42-2.42.04-.08a1.7 1.7 0 0 0-.34-1.88L4.2 6.06 5.62 3.6l.08.02a1.7 1.7 0 0 0 1.8-.65l.05-.07h2.84l.03.09a1.7 1.7 0 0 0 3.16 0l.03-.09h2.84l.05.07a1.7 1.7 0 0 0 1.8.65l.08-.02 1.42 2.46-.06.06A1.7 1.7 0 0 0 19.4 8l.04.08 1.42 2.42-.07.06a1.7 1.7 0 0 0 0 1.88l.07.06-1.42 2.42z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
  logout: 'M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9',
  cursor: 'M5 3l14 7-6 2-2 6z',
  task: 'M5 7h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z',
  gateway: 'M12 3l9 9-9 9-9-9z',
  start: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z',
  end: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z',
  connect: 'M5 6h8a3 3 0 0 1 3 3v9M13 15l3 3 3-3',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  send: 'M21 4L10 14M21 4l-6.5 17-4.5-7-7-4.5z',
};

export function Icon({ name, size = 16, stroke = 2 }: { name: keyof typeof paths; size?: number; stroke?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === 'play' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
