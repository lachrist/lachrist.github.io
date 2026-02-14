export type DateString = string & { __brand: "CalendarDate" };

export type Color = string & { __brand: "Color" };

export type Event = {
  title: string;
  description: string[];
  date: DateString;
};

export type Span = {
  from: DateString;
  to: DateString;
};

export type OngoingSpan = {
  from: DateString;
  to: null;
};

export type Block = {
  span: Span | OngoingSpan;
  color: Color;
  events: Event[];
};

export type Timeline = {
  blocks: Block[];
};

export type Calendar = {
  lines: Timeline[];
  begin: DateString;
  events: Event[];
};
