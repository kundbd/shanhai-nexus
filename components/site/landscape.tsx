const contour = "M-63 325C-5 310 28 318 78 282c47-34 65-83 111-113 33-22 49-20 83 9 24 20 43 29 57 16 17-16 34-35 60-26 28 10 35 37 62 41 29 5 61-25 94-15 36 11 49 33 94 38 21 3 39 2 58-3";

export function Landscape() {
  return <svg className="landscape" viewBox="0 0 632 420" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="range-fill" x1="334" y1="160" x2="334" y2="399" gradientUnits="userSpaceOnUse">
        <stop stopColor="#7ba997" stopOpacity=".45" />
        <stop offset="1" stopColor="#a3c5b4" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="ridge-fill" x1="440" y1="197" x2="440" y2="391" gradientUnits="userSpaceOnUse">
        <stop stopColor="#548774" stopOpacity=".32" />
        <stop offset="1" stopColor="#83af9c" stopOpacity="0" />
      </linearGradient>
      <radialGradient id="sun-fill">
        <stop stopColor="#e7cba0" stopOpacity=".8" />
        <stop offset="1" stopColor="#e7cba0" stopOpacity=".2" />
      </radialGradient>
    </defs>
    <circle cx="447" cy="118" r="53" fill="url(#sun-fill)" />
    <circle cx="447" cy="118" r="66" stroke="#b7ab8d" strokeOpacity=".35" />
    <path d="M447 42v9m0 134v9m-76-76h9m134 0h9" stroke="#958b70" strokeOpacity=".6" />
    <path d={`${contour}V430H-63Z`} fill="url(#range-fill)" />
    <g stroke="#416b5e" strokeWidth=".77" strokeOpacity=".4">
      {[0, 12, 25, 38, 51, 65, 79, 94, 110].map((y) =>
        <path key={y} d={contour} transform={`translate(${y * 0.23} ${y})`} />)}
    </g>
    <path d="M145 395c72-17 82-47 143-68 43-15 71 0 113-17 39-16 58-65 88-51 25 10 35 39 76 30 36-8 44-29 77-25v156H145Z" fill="url(#ridge-fill)" />
    <g stroke="#4d796c" strokeOpacity=".37" strokeWidth=".78">
      {[0, 11, 23, 36, 49].map((y) =>
        <path key={y} d="M114 394c85-14 113-47 174-67 43-15 71 0 113-17 39-16 58-65 88-51 25 10 35 39 76 30 36-8 44-29 77-25" transform={`translate(${y / 3} ${y})`} />)}
    </g>
    <circle cx="188" cy="171" r="3.2" fill="#578977" />
    <circle cx="403" cy="309" r="2.6" fill="#578977" />
  </svg>;
}
