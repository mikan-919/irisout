const radius = signal(4)

render(
  <svg viewBox="0 0 20 20" xmlns:xlink="http://www.w3.org/1999/xlink">
    <use xlink:href="#dot" />
    <circle r={radius()} stroke-width="2" />
    <foreignObject>
      <div data-kind="html">text</div>
    </foreignObject>
  </svg>,
)

export {}
