const DOT_RADIUS = 8;

const LINE_WIDTH = 4;

const ZOOM_FACTOR = 1;

/**
 * @type {(
 *   element: HTMLElement,
 *   lines: string[],
 * ) => void}
 */
const addTooltip = (element, lines) => {
  /** @type {null | HTMLElement} */
  let tooltip = null;
  /** @type {(event: MouseEvent) => void} */
  element.onmousemove = (event) => {
    if (tooltip) {
      tooltip.style.left = `${event.pageX + 10}px`;
      tooltip.style.top = `${event.pageY + 10}px`;
    }
  };
  element.onmouseover = () => {
    element.style.filter = "brightness(1.5)";
    tooltip = document.createElement("div");
    tooltip.innerText = lines.join("\n");
    tooltip.style.position = "absolute";
    tooltip.style.background = "white";
    tooltip.style.border = "1px solid black";
    tooltip.style.padding = "4px";
    tooltip.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.2)";
    tooltip.style.borderRadius = "4px";
    document.body.appendChild(tooltip);
  };
  element.onmouseout = () => {
    element.style.filter = "brightness(1)";
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
  };
};

// /**
//  * @type {(
//  *   element: HTMLElement,
//  *   lines: string[],
//  * ) => void}
//  */
// const addTooltip = (element, lines) => {
//   /** @type {null | HTMLElement} */
//   let tooltip = null;
//   /** @type {( event: MouseEvent) => void} */
//   element.onmousemove = (event) => {
//     if (tooltip) {
//       tooltip.style.left = `${event.pageX + 10}px`;
//       tooltip.style.top = `${event.pageY + 10}px`;
//     }
//   };
//   element.onmouseover = () => {
//     tooltip = document.createElement("div");
//     tooltip.innerText = lines.join("\n");
//     tooltip.style.position = "absolute";
//     tooltip.style.background = "white";
//     tooltip.style.border = "1px solid black";
//     tooltip.style.padding = "4px";
//     document.body.appendChild(tooltip);
//   };
//   element.onmouseout = () => {
//     if (tooltip) {
//       tooltip.remove();
//       tooltip = null;
//     }
//   };
// };

/**
 * @type {(
 *   description: string[],
 *   color: string,
 * ) => HTMLElement}
 */
const renderEventDot = (description, color) => {
  const container = document.createElement("div");
  container.style.width = `${DOT_RADIUS * 2}px`;
  container.style.height = `${DOT_RADIUS * 2}px`;
  container.style.background = color;
  container.style.borderRadius = "50%";
  if (description.length > 0) {
    addTooltip(container, description);
  }
  return container;
};

/**
 * @type {(
 *   title: string,
 * ) => HTMLElement}
 */
const renderEventLabel = (title) => {
  const label = document.createElement("div");
  label.innerText = title;
  label.style.marginLeft = "8px";
  return label;
};

/**
 * @type {(
 *   event: {
 *     title: string,
 *     description: string[],
 *   },
 *   color: string,
 * ) => HTMLElement}
 */
const renderEvent = ({ title, description }, color) => {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.alignItems = "center";
  container.appendChild(renderEventDot(description, color));
  container.appendChild(renderEventLabel(title));
  return container;
};

/**
 * @type {(
 *   color: string,
 * ) => HTMLElement}
 */
const renderLine = (color) => {
  const container = document.createElement("div");
  container.style.width = `${LINE_WIDTH}px`;
  container.style.background = color;
  return container;
};

/**
 * @type {(
 *   date: import("./calendar").DateString,
 * ) => Date}
 */
const convertDate = (date) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
};

/**
 * @type {(
 *   date: Date,
 * ) => import("./calendar").DateString}
 */
const revertDate = (date) => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return makeDateString(year, month, day);
};

/**
 * @type {(
 *   span: import("./calendar").Span,
 * ) => number}
 */
const countSpanDays = ({ from, to }) => {
  const fromDate = convertDate(from);
  const toDate = convertDate(to);
  return (
    Math.round(toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)
  );
};

/**
 * @type {(
 *   event1: import("./calendar").Event,
 *   event2: import("./calendar").Event,
 * ) => number}
 */
const compareEventDate = (event1, event2) => {
  const date1 = convertDate(event1.date);
  const date2 = convertDate(event2.date);
  return date1.getTime() - date2.getTime();
};

/**
 * @type {(
 *   timeline: import("./calendar").Timeline,
 *   total_span: import("./calendar").Span,
 * ) => HTMLElement}
 */
const renderTimeline = (timeline, total_span) => {
  const container = document.createElement("div");
  container.style.position = "relative";
  container.style.width = "200px";
  for (const block of timeline.blocks) {
    {
      const child = renderLine(block.color);
      child.style.position = "absolute";
      child.style.left = `${DOT_RADIUS - LINE_WIDTH / 2}px`;
      child.style.top = "0px";
      const ratio =
        countSpanDays({
          from: block.span.from,
          to: block.span.to ?? total_span.to,
        }) / countSpanDays(total_span);
      child.style.height = `${ratio * 100}%`;
      const position =
        countSpanDays({ from: total_span.from, to: block.span.from }) /
        countSpanDays(total_span);
      child.style.top = `${position * 100}%`;
      container.appendChild(child);
    }
    let last_ratio = 0;
    for (const event of block.events.slice().sort(compareEventDate)) {
      const child = renderEvent(event, block.color);
      child.style.position = "absolute";
      child.style.left = "0px";
      const ratio =
        countSpanDays({ from: total_span.from, to: event.date }) /
        countSpanDays(total_span);
      const adjusted_ratio = Math.max(ratio, last_ratio + 0.01);
      last_ratio = adjusted_ratio;
      child.style.top = `${ratio * 100}%`;
      child.style.transform = "translateY(-50%)";
      container.appendChild(child);
    }
  }
  return container;
};

/**
 * @type {(
 *   year: number,
 *   month: number,
 *   day: number,
 * ) => import("./calendar").DateString}
 */
const makeDateString = (year, month, day) =>
  /** @type {import("./calendar").DateString} */ (
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  );

/**
 * @type {(
 *   span: import("./calendar").Span,
 * ) => import("./calendar").Event[]}
 */
const enumBeginYear = (span) => {
  /** @type {import("./calendar").Event[]} */
  const events = [];
  const begin = parseInt(span.from.split("-")[0], 10);
  const end = parseInt(span.to.split("-")[0], 10);
  for (let year = begin + 1; year <= end; year++) {
    events.push({
      title: String(year),
      description: [`Jan 1, ${year}`],
      date: makeDateString(year, 1, 1),
    });
  }
  return events;
};

/**
 * @type {(
 *   events: import("./calendar").Event[],
 *   total_span: import("./calendar").Span,
 * ) => import("./calendar").Timeline}
 */
const makeDefaultTimeline = (events, total_span) => ({
  blocks: [
    {
      span: total_span,
      color: /** @type {import("./calendar").Color} */ ("#888888"),
      events: [...events, ...enumBeginYear(total_span)],
    },
  ],
});

/**
 * @type {(
 *   num: number,
 *   min: number,
 *   max: number,
 * ) => number}
 */
const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

/**
 * @type {(
 *   initial: number,
 * ) => HTMLElement}
 */
export const renderSlider = (initial) => {
  if (initial <= 0 || initial > 1) {
    throw new Error("Initial value must be between 0 and 1");
  }
  const handle_radius = 10;
  const total_width = 200;
  const min_handle_pos = handle_radius;
  const max_handle_pos = total_width - handle_radius;
  const handle_span = max_handle_pos - min_handle_pos;
  const container = document.createElement("div");
  container.style.width = `${total_width}px`;
  container.style.height = `${2 * handle_radius}px`;
  container.style.background = "#ddd";
  container.style.position = "relative";
  container.style.borderRadius = "10px";
  container.style.cursor = "pointer";
  const handle = document.createElement("div");
  handle.style.width = `${2 * handle_radius}px`;
  handle.style.height = `${2 * handle_radius}px`;
  handle.style.background = "#555";
  handle.style.position = "absolute";
  // value = (pos - min_handle_pos) / handle_span
  // left = pos - handle_radius
  // => left = value * handle_span + min_handle_pos - handle_radius
  handle.style.left = `${initial * handle_span + min_handle_pos - handle_radius}px`;
  handle.style.top = "0px";
  handle.style.borderRadius = "50%";
  container.appendChild(handle);
  /** @type {(event: MouseEvent) => void} */
  const drag = (event) => {
    const rect = container.getBoundingClientRect();
    const pos = clamp(
      event.clientX - rect.left,
      min_handle_pos,
      max_handle_pos,
    );
    handle.style.left = `${pos - handle_radius}px`;
    const value = (pos - min_handle_pos) / handle_span;
    console.log("Slider value:", value);
    container.dispatchEvent(
      new CustomEvent("slider-change", { detail: { value } }),
    );
  };
  const unregisterDrag = () => {
    document.removeEventListener("mousemove", drag);
  };
  handle.addEventListener("mousedown", () => {
    document.addEventListener("mousemove", drag);
    document.addEventListener("mouseup", unregisterDrag, { once: true });
  });
  container.addEventListener("click", drag);
  return container;
};

/**
 * @type {(
 *   calendar: import("./calendar").Calendar,
 *   date: Date,
 * ) => HTMLElement}
 */
export const renderCalendar = (calendar, today) => {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "32px";
  /** @type {import("./calendar").Span} */
  const total_span = {
    from: calendar.begin,
    to: revertDate(today),
  };
  const day_count = countSpanDays(total_span);
  const initial_zoom = 0.1;
  const slider = renderSlider(initial_zoom);
  container.appendChild(slider);
  const sub_container = document.createElement("div");
  slider.addEventListener("slider-change", (event) => {
    const zoom = /** @type {{detail: { value: number }}} */ (
      /** @type {unknown} */ (event)
    ).detail.value;
    sub_container.style.height = `${day_count * ZOOM_FACTOR * zoom}px`;
  });
  sub_container.style.display = "flex";
  container.style.flexDirection = "column";
  sub_container.style.gap = "16px";
  sub_container.style.height = `${day_count * ZOOM_FACTOR * initial_zoom}px`;
  for (const timeline of [
    makeDefaultTimeline(calendar.events, total_span),
    ...calendar.lines,
  ]) {
    const child = renderTimeline(timeline, total_span);
    sub_container.appendChild(child);
  }
  container.appendChild(sub_container);
  return container;
};
