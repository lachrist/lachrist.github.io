/**
The data structure for documents. @nonabstract
*/
class Text {
    /**
    Get the line description around the given position.
    */
    lineAt(pos) {
        if (pos < 0 || pos > this.length)
            throw new RangeError(`Invalid position ${pos} in document of length ${this.length}`);
        return this.lineInner(pos, false, 1, 0);
    }
    /**
    Get the description for the given (1-based) line number.
    */
    line(n) {
        if (n < 1 || n > this.lines)
            throw new RangeError(`Invalid line number ${n} in ${this.lines}-line document`);
        return this.lineInner(n, true, 1, 0);
    }
    /**
    Replace a range of the text with the given content.
    */
    replace(from, to, text) {
        [from, to] = clip(this, from, to);
        let parts = [];
        this.decompose(0, from, parts, 2 /* Open.To */);
        if (text.length)
            text.decompose(0, text.length, parts, 1 /* Open.From */ | 2 /* Open.To */);
        this.decompose(to, this.length, parts, 1 /* Open.From */);
        return TextNode.from(parts, this.length - (to - from) + text.length);
    }
    /**
    Append another document to this one.
    */
    append(other) {
        return this.replace(this.length, this.length, other);
    }
    /**
    Retrieve the text between the given points.
    */
    slice(from, to = this.length) {
        [from, to] = clip(this, from, to);
        let parts = [];
        this.decompose(from, to, parts, 0);
        return TextNode.from(parts, to - from);
    }
    /**
    Test whether this text is equal to another instance.
    */
    eq(other) {
        if (other == this)
            return true;
        if (other.length != this.length || other.lines != this.lines)
            return false;
        let start = this.scanIdentical(other, 1), end = this.length - this.scanIdentical(other, -1);
        let a = new RawTextCursor(this), b = new RawTextCursor(other);
        for (let skip = start, pos = start;;) {
            a.next(skip);
            b.next(skip);
            skip = 0;
            if (a.lineBreak != b.lineBreak || a.done != b.done || a.value != b.value)
                return false;
            pos += a.value.length;
            if (a.done || pos >= end)
                return true;
        }
    }
    /**
    Iterate over the text. When `dir` is `-1`, iteration happens
    from end to start. This will return lines and the breaks between
    them as separate strings.
    */
    iter(dir = 1) { return new RawTextCursor(this, dir); }
    /**
    Iterate over a range of the text. When `from` > `to`, the
    iterator will run in reverse.
    */
    iterRange(from, to = this.length) { return new PartialTextCursor(this, from, to); }
    /**
    Return a cursor that iterates over the given range of lines,
    _without_ returning the line breaks between, and yielding empty
    strings for empty lines.
    
    When `from` and `to` are given, they should be 1-based line numbers.
    */
    iterLines(from, to) {
        let inner;
        if (from == null) {
            inner = this.iter();
        }
        else {
            if (to == null)
                to = this.lines + 1;
            let start = this.line(from).from;
            inner = this.iterRange(start, Math.max(start, to == this.lines + 1 ? this.length : to <= 1 ? 0 : this.line(to - 1).to));
        }
        return new LineCursor(inner);
    }
    /**
    Return the document as a string, using newline characters to
    separate lines.
    */
    toString() { return this.sliceString(0); }
    /**
    Convert the document to an array of lines (which can be
    deserialized again via [`Text.of`](https://codemirror.net/6/docs/ref/#state.Text^of)).
    */
    toJSON() {
        let lines = [];
        this.flatten(lines);
        return lines;
    }
    /**
    @internal
    */
    constructor() { }
    /**
    Create a `Text` instance for the given array of lines.
    */
    static of(text) {
        if (text.length == 0)
            throw new RangeError("A document must have at least one line");
        if (text.length == 1 && !text[0])
            return Text.empty;
        return text.length <= 32 /* Tree.Branch */ ? new TextLeaf(text) : TextNode.from(TextLeaf.split(text, []));
    }
}
// Leaves store an array of line strings. There are always line breaks
// between these strings. Leaves are limited in size and have to be
// contained in TextNode instances for bigger documents.
class TextLeaf extends Text {
    constructor(text, length = textLength(text)) {
        super();
        this.text = text;
        this.length = length;
    }
    get lines() { return this.text.length; }
    get children() { return null; }
    lineInner(target, isLine, line, offset) {
        for (let i = 0;; i++) {
            let string = this.text[i], end = offset + string.length;
            if ((isLine ? line : end) >= target)
                return new Line(offset, end, line, string);
            offset = end + 1;
            line++;
        }
    }
    decompose(from, to, target, open) {
        let text = from <= 0 && to >= this.length ? this
            : new TextLeaf(sliceText(this.text, from, to), Math.min(to, this.length) - Math.max(0, from));
        if (open & 1 /* Open.From */) {
            let prev = target.pop();
            let joined = appendText(text.text, prev.text.slice(), 0, text.length);
            if (joined.length <= 32 /* Tree.Branch */) {
                target.push(new TextLeaf(joined, prev.length + text.length));
            }
            else {
                let mid = joined.length >> 1;
                target.push(new TextLeaf(joined.slice(0, mid)), new TextLeaf(joined.slice(mid)));
            }
        }
        else {
            target.push(text);
        }
    }
    replace(from, to, text) {
        if (!(text instanceof TextLeaf))
            return super.replace(from, to, text);
        [from, to] = clip(this, from, to);
        let lines = appendText(this.text, appendText(text.text, sliceText(this.text, 0, from)), to);
        let newLen = this.length + text.length - (to - from);
        if (lines.length <= 32 /* Tree.Branch */)
            return new TextLeaf(lines, newLen);
        return TextNode.from(TextLeaf.split(lines, []), newLen);
    }
    sliceString(from, to = this.length, lineSep = "\n") {
        [from, to] = clip(this, from, to);
        let result = "";
        for (let pos = 0, i = 0; pos <= to && i < this.text.length; i++) {
            let line = this.text[i], end = pos + line.length;
            if (pos > from && i)
                result += lineSep;
            if (from < end && to > pos)
                result += line.slice(Math.max(0, from - pos), to - pos);
            pos = end + 1;
        }
        return result;
    }
    flatten(target) {
        for (let line of this.text)
            target.push(line);
    }
    scanIdentical() { return 0; }
    static split(text, target) {
        let part = [], len = -1;
        for (let line of text) {
            part.push(line);
            len += line.length + 1;
            if (part.length == 32 /* Tree.Branch */) {
                target.push(new TextLeaf(part, len));
                part = [];
                len = -1;
            }
        }
        if (len > -1)
            target.push(new TextLeaf(part, len));
        return target;
    }
}
// Nodes provide the tree structure of the `Text` type. They store a
// number of other nodes or leaves, taking care to balance themselves
// on changes. There are implied line breaks _between_ the children of
// a node (but not before the first or after the last child).
class TextNode extends Text {
    constructor(children, length) {
        super();
        this.children = children;
        this.length = length;
        this.lines = 0;
        for (let child of children)
            this.lines += child.lines;
    }
    lineInner(target, isLine, line, offset) {
        for (let i = 0;; i++) {
            let child = this.children[i], end = offset + child.length, endLine = line + child.lines - 1;
            if ((isLine ? endLine : end) >= target)
                return child.lineInner(target, isLine, line, offset);
            offset = end + 1;
            line = endLine + 1;
        }
    }
    decompose(from, to, target, open) {
        for (let i = 0, pos = 0; pos <= to && i < this.children.length; i++) {
            let child = this.children[i], end = pos + child.length;
            if (from <= end && to >= pos) {
                let childOpen = open & ((pos <= from ? 1 /* Open.From */ : 0) | (end >= to ? 2 /* Open.To */ : 0));
                if (pos >= from && end <= to && !childOpen)
                    target.push(child);
                else
                    child.decompose(from - pos, to - pos, target, childOpen);
            }
            pos = end + 1;
        }
    }
    replace(from, to, text) {
        [from, to] = clip(this, from, to);
        if (text.lines < this.lines)
            for (let i = 0, pos = 0; i < this.children.length; i++) {
                let child = this.children[i], end = pos + child.length;
                // Fast path: if the change only affects one child and the
                // child's size remains in the acceptable range, only update
                // that child
                if (from >= pos && to <= end) {
                    let updated = child.replace(from - pos, to - pos, text);
                    let totalLines = this.lines - child.lines + updated.lines;
                    if (updated.lines < (totalLines >> (5 /* Tree.BranchShift */ - 1)) &&
                        updated.lines > (totalLines >> (5 /* Tree.BranchShift */ + 1))) {
                        let copy = this.children.slice();
                        copy[i] = updated;
                        return new TextNode(copy, this.length - (to - from) + text.length);
                    }
                    return super.replace(pos, end, updated);
                }
                pos = end + 1;
            }
        return super.replace(from, to, text);
    }
    sliceString(from, to = this.length, lineSep = "\n") {
        [from, to] = clip(this, from, to);
        let result = "";
        for (let i = 0, pos = 0; i < this.children.length && pos <= to; i++) {
            let child = this.children[i], end = pos + child.length;
            if (pos > from && i)
                result += lineSep;
            if (from < end && to > pos)
                result += child.sliceString(from - pos, to - pos, lineSep);
            pos = end + 1;
        }
        return result;
    }
    flatten(target) {
        for (let child of this.children)
            child.flatten(target);
    }
    scanIdentical(other, dir) {
        if (!(other instanceof TextNode))
            return 0;
        let length = 0;
        let [iA, iB, eA, eB] = dir > 0 ? [0, 0, this.children.length, other.children.length]
            : [this.children.length - 1, other.children.length - 1, -1, -1];
        for (;; iA += dir, iB += dir) {
            if (iA == eA || iB == eB)
                return length;
            let chA = this.children[iA], chB = other.children[iB];
            if (chA != chB)
                return length + chA.scanIdentical(chB, dir);
            length += chA.length + 1;
        }
    }
    static from(children, length = children.reduce((l, ch) => l + ch.length + 1, -1)) {
        let lines = 0;
        for (let ch of children)
            lines += ch.lines;
        if (lines < 32 /* Tree.Branch */) {
            let flat = [];
            for (let ch of children)
                ch.flatten(flat);
            return new TextLeaf(flat, length);
        }
        let chunk = Math.max(32 /* Tree.Branch */, lines >> 5 /* Tree.BranchShift */), maxChunk = chunk << 1, minChunk = chunk >> 1;
        let chunked = [], currentLines = 0, currentLen = -1, currentChunk = [];
        function add(child) {
            let last;
            if (child.lines > maxChunk && child instanceof TextNode) {
                for (let node of child.children)
                    add(node);
            }
            else if (child.lines > minChunk && (currentLines > minChunk || !currentLines)) {
                flush();
                chunked.push(child);
            }
            else if (child instanceof TextLeaf && currentLines &&
                (last = currentChunk[currentChunk.length - 1]) instanceof TextLeaf &&
                child.lines + last.lines <= 32 /* Tree.Branch */) {
                currentLines += child.lines;
                currentLen += child.length + 1;
                currentChunk[currentChunk.length - 1] = new TextLeaf(last.text.concat(child.text), last.length + 1 + child.length);
            }
            else {
                if (currentLines + child.lines > chunk)
                    flush();
                currentLines += child.lines;
                currentLen += child.length + 1;
                currentChunk.push(child);
            }
        }
        function flush() {
            if (currentLines == 0)
                return;
            chunked.push(currentChunk.length == 1 ? currentChunk[0] : TextNode.from(currentChunk, currentLen));
            currentLen = -1;
            currentLines = currentChunk.length = 0;
        }
        for (let child of children)
            add(child);
        flush();
        return chunked.length == 1 ? chunked[0] : new TextNode(chunked, length);
    }
}
Text.empty = /*@__PURE__*/new TextLeaf([""], 0);
function textLength(text) {
    let length = -1;
    for (let line of text)
        length += line.length + 1;
    return length;
}
function appendText(text, target, from = 0, to = 1e9) {
    for (let pos = 0, i = 0, first = true; i < text.length && pos <= to; i++) {
        let line = text[i], end = pos + line.length;
        if (end >= from) {
            if (end > to)
                line = line.slice(0, to - pos);
            if (pos < from)
                line = line.slice(from - pos);
            if (first) {
                target[target.length - 1] += line;
                first = false;
            }
            else
                target.push(line);
        }
        pos = end + 1;
    }
    return target;
}
function sliceText(text, from, to) {
    return appendText(text, [""], from, to);
}
class RawTextCursor {
    constructor(text, dir = 1) {
        this.dir = dir;
        this.done = false;
        this.lineBreak = false;
        this.value = "";
        this.nodes = [text];
        this.offsets = [dir > 0 ? 1 : (text instanceof TextLeaf ? text.text.length : text.children.length) << 1];
    }
    nextInner(skip, dir) {
        this.done = this.lineBreak = false;
        for (;;) {
            let last = this.nodes.length - 1;
            let top = this.nodes[last], offsetValue = this.offsets[last], offset = offsetValue >> 1;
            let size = top instanceof TextLeaf ? top.text.length : top.children.length;
            if (offset == (dir > 0 ? size : 0)) {
                if (last == 0) {
                    this.done = true;
                    this.value = "";
                    return this;
                }
                if (dir > 0)
                    this.offsets[last - 1]++;
                this.nodes.pop();
                this.offsets.pop();
            }
            else if ((offsetValue & 1) == (dir > 0 ? 0 : 1)) {
                this.offsets[last] += dir;
                if (skip == 0) {
                    this.lineBreak = true;
                    this.value = "\n";
                    return this;
                }
                skip--;
            }
            else if (top instanceof TextLeaf) {
                // Move to the next string
                let next = top.text[offset + (dir < 0 ? -1 : 0)];
                this.offsets[last] += dir;
                if (next.length > Math.max(0, skip)) {
                    this.value = skip == 0 ? next : dir > 0 ? next.slice(skip) : next.slice(0, next.length - skip);
                    return this;
                }
                skip -= next.length;
            }
            else {
                let next = top.children[offset + (dir < 0 ? -1 : 0)];
                if (skip > next.length) {
                    skip -= next.length;
                    this.offsets[last] += dir;
                }
                else {
                    if (dir < 0)
                        this.offsets[last]--;
                    this.nodes.push(next);
                    this.offsets.push(dir > 0 ? 1 : (next instanceof TextLeaf ? next.text.length : next.children.length) << 1);
                }
            }
        }
    }
    next(skip = 0) {
        if (skip < 0) {
            this.nextInner(-skip, (-this.dir));
            skip = this.value.length;
        }
        return this.nextInner(skip, this.dir);
    }
}
class PartialTextCursor {
    constructor(text, start, end) {
        this.value = "";
        this.done = false;
        this.cursor = new RawTextCursor(text, start > end ? -1 : 1);
        this.pos = start > end ? text.length : 0;
        this.from = Math.min(start, end);
        this.to = Math.max(start, end);
    }
    nextInner(skip, dir) {
        if (dir < 0 ? this.pos <= this.from : this.pos >= this.to) {
            this.value = "";
            this.done = true;
            return this;
        }
        skip += Math.max(0, dir < 0 ? this.pos - this.to : this.from - this.pos);
        let limit = dir < 0 ? this.pos - this.from : this.to - this.pos;
        if (skip > limit)
            skip = limit;
        limit -= skip;
        let { value } = this.cursor.next(skip);
        this.pos += (value.length + skip) * dir;
        this.value = value.length <= limit ? value : dir < 0 ? value.slice(value.length - limit) : value.slice(0, limit);
        this.done = !this.value;
        return this;
    }
    next(skip = 0) {
        if (skip < 0)
            skip = Math.max(skip, this.from - this.pos);
        else if (skip > 0)
            skip = Math.min(skip, this.to - this.pos);
        return this.nextInner(skip, this.cursor.dir);
    }
    get lineBreak() { return this.cursor.lineBreak && this.value != ""; }
}
class LineCursor {
    constructor(inner) {
        this.inner = inner;
        this.afterBreak = true;
        this.value = "";
        this.done = false;
    }
    next(skip = 0) {
        let { done, lineBreak, value } = this.inner.next(skip);
        if (done && this.afterBreak) {
            this.value = "";
            this.afterBreak = false;
        }
        else if (done) {
            this.done = true;
            this.value = "";
        }
        else if (lineBreak) {
            if (this.afterBreak) {
                this.value = "";
            }
            else {
                this.afterBreak = true;
                this.next();
            }
        }
        else {
            this.value = value;
            this.afterBreak = false;
        }
        return this;
    }
    get lineBreak() { return false; }
}
if (typeof Symbol != "undefined") {
    Text.prototype[Symbol.iterator] = function () { return this.iter(); };
    RawTextCursor.prototype[Symbol.iterator] = PartialTextCursor.prototype[Symbol.iterator] =
        LineCursor.prototype[Symbol.iterator] = function () { return this; };
}
/**
This type describes a line in the document. It is created
on-demand when lines are [queried](https://codemirror.net/6/docs/ref/#state.Text.lineAt).
*/
class Line {
    /**
    @internal
    */
    constructor(
    /**
    The position of the start of the line.
    */
    from, 
    /**
    The position at the end of the line (_before_ the line break,
    or at the end of document for the last line).
    */
    to, 
    /**
    This line's line number (1-based).
    */
    number, 
    /**
    The line's content.
    */
    text) {
        this.from = from;
        this.to = to;
        this.number = number;
        this.text = text;
    }
    /**
    The length of the line (not including any line break after it).
    */
    get length() { return this.to - this.from; }
}
function clip(text, from, to) {
    from = Math.max(0, Math.min(text.length, from));
    return [from, Math.max(from, Math.min(text.length, to))];
}

// Compressed representation of the Grapheme_Cluster_Break=Extend
// information from
// http://www.unicode.org/Public/13.0.0/ucd/auxiliary/GraphemeBreakProperty.txt.
// Each pair of elements represents a range, as an offet from the
// previous range and a length. Numbers are in base-36, with the empty
// string being a shorthand for 1.
let extend = /*@__PURE__*/"lc,34,7n,7,7b,19,,,,2,,2,,,20,b,1c,l,g,,2t,7,2,6,2,2,,4,z,,u,r,2j,b,1m,9,9,,o,4,,9,,3,,5,17,3,3b,f,,w,1j,,,,4,8,4,,3,7,a,2,t,,1m,,,,2,4,8,,9,,a,2,q,,2,2,1l,,4,2,4,2,2,3,3,,u,2,3,,b,2,1l,,4,5,,2,4,,k,2,m,6,,,1m,,,2,,4,8,,7,3,a,2,u,,1n,,,,c,,9,,14,,3,,1l,3,5,3,,4,7,2,b,2,t,,1m,,2,,2,,3,,5,2,7,2,b,2,s,2,1l,2,,,2,4,8,,9,,a,2,t,,20,,4,,2,3,,,8,,29,,2,7,c,8,2q,,2,9,b,6,22,2,r,,,,,,1j,e,,5,,2,5,b,,10,9,,2u,4,,6,,2,2,2,p,2,4,3,g,4,d,,2,2,6,,f,,jj,3,qa,3,t,3,t,2,u,2,1s,2,,7,8,,2,b,9,,19,3,3b,2,y,,3a,3,4,2,9,,6,3,63,2,2,,1m,,,7,,,,,2,8,6,a,2,,1c,h,1r,4,1c,7,,,5,,14,9,c,2,w,4,2,2,,3,1k,,,2,3,,,3,1m,8,2,2,48,3,,d,,7,4,,6,,3,2,5i,1m,,5,ek,,5f,x,2da,3,3x,,2o,w,fe,6,2x,2,n9w,4,,a,w,2,28,2,7k,,3,,4,,p,2,5,,47,2,q,i,d,,12,8,p,b,1a,3,1c,,2,4,2,2,13,,1v,6,2,2,2,2,c,,8,,1b,,1f,,,3,2,2,5,2,,,16,2,8,,6m,,2,,4,,fn4,,kh,g,g,g,a6,2,gt,,6a,,45,5,1ae,3,,2,5,4,14,3,4,,4l,2,fx,4,ar,2,49,b,4w,,1i,f,1k,3,1d,4,2,2,1x,3,10,5,,8,1q,,c,2,1g,9,a,4,2,,2n,3,2,,,2,6,,4g,,3,8,l,2,1l,2,,,,,m,,e,7,3,5,5f,8,2,3,,,n,,29,,2,6,,,2,,,2,,2,6j,,2,4,6,2,,2,r,2,2d,8,2,,,2,2y,,,,2,6,,,2t,3,2,4,,5,77,9,,2,6t,,a,2,,,4,,40,4,2,2,4,,w,a,14,6,2,4,8,,9,6,2,3,1a,d,,2,ba,7,,6,,,2a,m,2,7,,2,,2,3e,6,3,,,2,,7,,,20,2,3,,,,9n,2,f0b,5,1n,7,t4,,1r,4,29,,f5k,2,43q,,,3,4,5,8,8,2,7,u,4,44,3,1iz,1j,4,1e,8,,e,,m,5,,f,11s,7,,h,2,7,,2,,5,79,7,c5,4,15s,7,31,7,240,5,gx7k,2o,3k,6o".split(",").map(s => s ? parseInt(s, 36) : 1);
// Convert offsets into absolute values
for (let i = 1; i < extend.length; i++)
    extend[i] += extend[i - 1];
function isExtendingChar(code) {
    for (let i = 1; i < extend.length; i += 2)
        if (extend[i] > code)
            return extend[i - 1] <= code;
    return false;
}
function isRegionalIndicator(code) {
    return code >= 0x1F1E6 && code <= 0x1F1FF;
}
const ZWJ = 0x200d;
/**
Returns a next grapheme cluster break _after_ (not equal to)
`pos`, if `forward` is true, or before otherwise. Returns `pos`
itself if no further cluster break is available in the string.
Moves across surrogate pairs, extending characters (when
`includeExtending` is true), characters joined with zero-width
joiners, and flag emoji.
*/
function findClusterBreak(str, pos, forward = true, includeExtending = true) {
    return (forward ? nextClusterBreak : prevClusterBreak)(str, pos, includeExtending);
}
function nextClusterBreak(str, pos, includeExtending) {
    if (pos == str.length)
        return pos;
    // If pos is in the middle of a surrogate pair, move to its start
    if (pos && surrogateLow(str.charCodeAt(pos)) && surrogateHigh(str.charCodeAt(pos - 1)))
        pos--;
    let prev = codePointAt(str, pos);
    pos += codePointSize(prev);
    while (pos < str.length) {
        let next = codePointAt(str, pos);
        if (prev == ZWJ || next == ZWJ || includeExtending && isExtendingChar(next)) {
            pos += codePointSize(next);
            prev = next;
        }
        else if (isRegionalIndicator(next)) {
            let countBefore = 0, i = pos - 2;
            while (i >= 0 && isRegionalIndicator(codePointAt(str, i))) {
                countBefore++;
                i -= 2;
            }
            if (countBefore % 2 == 0)
                break;
            else
                pos += 2;
        }
        else {
            break;
        }
    }
    return pos;
}
function prevClusterBreak(str, pos, includeExtending) {
    while (pos > 0) {
        let found = nextClusterBreak(str, pos - 2, includeExtending);
        if (found < pos)
            return found;
        pos--;
    }
    return 0;
}
function surrogateLow(ch) { return ch >= 0xDC00 && ch < 0xE000; }
function surrogateHigh(ch) { return ch >= 0xD800 && ch < 0xDC00; }
/**
Find the code point at the given position in a string (like the
[`codePointAt`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/codePointAt)
string method).
*/
function codePointAt(str, pos) {
    let code0 = str.charCodeAt(pos);
    if (!surrogateHigh(code0) || pos + 1 == str.length)
        return code0;
    let code1 = str.charCodeAt(pos + 1);
    if (!surrogateLow(code1))
        return code0;
    return ((code0 - 0xd800) << 10) + (code1 - 0xdc00) + 0x10000;
}
/**
The amount of positions a character takes up a JavaScript string.
*/
function codePointSize(code) { return code < 0x10000 ? 1 : 2; }

const DefaultSplit = /\r\n?|\n/;
/**
Distinguishes different ways in which positions can be mapped.
*/
var MapMode = /*@__PURE__*/(function (MapMode) {
    /**
    Map a position to a valid new position, even when its context
    was deleted.
    */
    MapMode[MapMode["Simple"] = 0] = "Simple";
    /**
    Return null if deletion happens across the position.
    */
    MapMode[MapMode["TrackDel"] = 1] = "TrackDel";
    /**
    Return null if the character _before_ the position is deleted.
    */
    MapMode[MapMode["TrackBefore"] = 2] = "TrackBefore";
    /**
    Return null if the character _after_ the position is deleted.
    */
    MapMode[MapMode["TrackAfter"] = 3] = "TrackAfter";
return MapMode})(MapMode || (MapMode = {}));
/**
A change description is a variant of [change set](https://codemirror.net/6/docs/ref/#state.ChangeSet)
that doesn't store the inserted text. As such, it can't be
applied, but is cheaper to store and manipulate.
*/
class ChangeDesc {
    // Sections are encoded as pairs of integers. The first is the
    // length in the current document, and the second is -1 for
    // unaffected sections, and the length of the replacement content
    // otherwise. So an insertion would be (0, n>0), a deletion (n>0,
    // 0), and a replacement two positive numbers.
    /**
    @internal
    */
    constructor(
    /**
    @internal
    */
    sections) {
        this.sections = sections;
    }
    /**
    The length of the document before the change.
    */
    get length() {
        let result = 0;
        for (let i = 0; i < this.sections.length; i += 2)
            result += this.sections[i];
        return result;
    }
    /**
    The length of the document after the change.
    */
    get newLength() {
        let result = 0;
        for (let i = 0; i < this.sections.length; i += 2) {
            let ins = this.sections[i + 1];
            result += ins < 0 ? this.sections[i] : ins;
        }
        return result;
    }
    /**
    False when there are actual changes in this set.
    */
    get empty() { return this.sections.length == 0 || this.sections.length == 2 && this.sections[1] < 0; }
    /**
    Iterate over the unchanged parts left by these changes. `posA`
    provides the position of the range in the old document, `posB`
    the new position in the changed document.
    */
    iterGaps(f) {
        for (let i = 0, posA = 0, posB = 0; i < this.sections.length;) {
            let len = this.sections[i++], ins = this.sections[i++];
            if (ins < 0) {
                f(posA, posB, len);
                posB += len;
            }
            else {
                posB += ins;
            }
            posA += len;
        }
    }
    /**
    Iterate over the ranges changed by these changes. (See
    [`ChangeSet.iterChanges`](https://codemirror.net/6/docs/ref/#state.ChangeSet.iterChanges) for a
    variant that also provides you with the inserted text.)
    `fromA`/`toA` provides the extent of the change in the starting
    document, `fromB`/`toB` the extent of the replacement in the
    changed document.
    
    When `individual` is true, adjacent changes (which are kept
    separate for [position mapping](https://codemirror.net/6/docs/ref/#state.ChangeDesc.mapPos)) are
    reported separately.
    */
    iterChangedRanges(f, individual = false) {
        iterChanges(this, f, individual);
    }
    /**
    Get a description of the inverted form of these changes.
    */
    get invertedDesc() {
        let sections = [];
        for (let i = 0; i < this.sections.length;) {
            let len = this.sections[i++], ins = this.sections[i++];
            if (ins < 0)
                sections.push(len, ins);
            else
                sections.push(ins, len);
        }
        return new ChangeDesc(sections);
    }
    /**
    Compute the combined effect of applying another set of changes
    after this one. The length of the document after this set should
    match the length before `other`.
    */
    composeDesc(other) { return this.empty ? other : other.empty ? this : composeSets(this, other); }
    /**
    Map this description, which should start with the same document
    as `other`, over another set of changes, so that it can be
    applied after it. When `before` is true, map as if the changes
    in `other` happened before the ones in `this`.
    */
    mapDesc(other, before = false) { return other.empty ? this : mapSet(this, other, before); }
    mapPos(pos, assoc = -1, mode = MapMode.Simple) {
        let posA = 0, posB = 0;
        for (let i = 0; i < this.sections.length;) {
            let len = this.sections[i++], ins = this.sections[i++], endA = posA + len;
            if (ins < 0) {
                if (endA > pos)
                    return posB + (pos - posA);
                posB += len;
            }
            else {
                if (mode != MapMode.Simple && endA >= pos &&
                    (mode == MapMode.TrackDel && posA < pos && endA > pos ||
                        mode == MapMode.TrackBefore && posA < pos ||
                        mode == MapMode.TrackAfter && endA > pos))
                    return null;
                if (endA > pos || endA == pos && assoc < 0 && !len)
                    return pos == posA || assoc < 0 ? posB : posB + ins;
                posB += ins;
            }
            posA = endA;
        }
        if (pos > posA)
            throw new RangeError(`Position ${pos} is out of range for changeset of length ${posA}`);
        return posB;
    }
    /**
    Check whether these changes touch a given range. When one of the
    changes entirely covers the range, the string `"cover"` is
    returned.
    */
    touchesRange(from, to = from) {
        for (let i = 0, pos = 0; i < this.sections.length && pos <= to;) {
            let len = this.sections[i++], ins = this.sections[i++], end = pos + len;
            if (ins >= 0 && pos <= to && end >= from)
                return pos < from && end > to ? "cover" : true;
            pos = end;
        }
        return false;
    }
    /**
    @internal
    */
    toString() {
        let result = "";
        for (let i = 0; i < this.sections.length;) {
            let len = this.sections[i++], ins = this.sections[i++];
            result += (result ? " " : "") + len + (ins >= 0 ? ":" + ins : "");
        }
        return result;
    }
    /**
    Serialize this change desc to a JSON-representable value.
    */
    toJSON() { return this.sections; }
    /**
    Create a change desc from its JSON representation (as produced
    by [`toJSON`](https://codemirror.net/6/docs/ref/#state.ChangeDesc.toJSON).
    */
    static fromJSON(json) {
        if (!Array.isArray(json) || json.length % 2 || json.some(a => typeof a != "number"))
            throw new RangeError("Invalid JSON representation of ChangeDesc");
        return new ChangeDesc(json);
    }
    /**
    @internal
    */
    static create(sections) { return new ChangeDesc(sections); }
}
/**
A change set represents a group of modifications to a document. It
stores the document length, and can only be applied to documents
with exactly that length.
*/
class ChangeSet extends ChangeDesc {
    constructor(sections, 
    /**
    @internal
    */
    inserted) {
        super(sections);
        this.inserted = inserted;
    }
    /**
    Apply the changes to a document, returning the modified
    document.
    */
    apply(doc) {
        if (this.length != doc.length)
            throw new RangeError("Applying change set to a document with the wrong length");
        iterChanges(this, (fromA, toA, fromB, _toB, text) => doc = doc.replace(fromB, fromB + (toA - fromA), text), false);
        return doc;
    }
    mapDesc(other, before = false) { return mapSet(this, other, before, true); }
    /**
    Given the document as it existed _before_ the changes, return a
    change set that represents the inverse of this set, which could
    be used to go from the document created by the changes back to
    the document as it existed before the changes.
    */
    invert(doc) {
        let sections = this.sections.slice(), inserted = [];
        for (let i = 0, pos = 0; i < sections.length; i += 2) {
            let len = sections[i], ins = sections[i + 1];
            if (ins >= 0) {
                sections[i] = ins;
                sections[i + 1] = len;
                let index = i >> 1;
                while (inserted.length < index)
                    inserted.push(Text.empty);
                inserted.push(len ? doc.slice(pos, pos + len) : Text.empty);
            }
            pos += len;
        }
        return new ChangeSet(sections, inserted);
    }
    /**
    Combine two subsequent change sets into a single set. `other`
    must start in the document produced by `this`. If `this` goes
    `docA` → `docB` and `other` represents `docB` → `docC`, the
    returned value will represent the change `docA` → `docC`.
    */
    compose(other) { return this.empty ? other : other.empty ? this : composeSets(this, other, true); }
    /**
    Given another change set starting in the same document, maps this
    change set over the other, producing a new change set that can be
    applied to the document produced by applying `other`. When
    `before` is `true`, order changes as if `this` comes before
    `other`, otherwise (the default) treat `other` as coming first.
    
    Given two changes `A` and `B`, `A.compose(B.map(A))` and
    `B.compose(A.map(B, true))` will produce the same document. This
    provides a basic form of [operational
    transformation](https://en.wikipedia.org/wiki/Operational_transformation),
    and can be used for collaborative editing.
    */
    map(other, before = false) { return other.empty ? this : mapSet(this, other, before, true); }
    /**
    Iterate over the changed ranges in the document, calling `f` for
    each, with the range in the original document (`fromA`-`toA`)
    and the range that replaces it in the new document
    (`fromB`-`toB`).
    
    When `individual` is true, adjacent changes are reported
    separately.
    */
    iterChanges(f, individual = false) {
        iterChanges(this, f, individual);
    }
    /**
    Get a [change description](https://codemirror.net/6/docs/ref/#state.ChangeDesc) for this change
    set.
    */
    get desc() { return ChangeDesc.create(this.sections); }
    /**
    @internal
    */
    filter(ranges) {
        let resultSections = [], resultInserted = [], filteredSections = [];
        let iter = new SectionIter(this);
        done: for (let i = 0, pos = 0;;) {
            let next = i == ranges.length ? 1e9 : ranges[i++];
            while (pos < next || pos == next && iter.len == 0) {
                if (iter.done)
                    break done;
                let len = Math.min(iter.len, next - pos);
                addSection(filteredSections, len, -1);
                let ins = iter.ins == -1 ? -1 : iter.off == 0 ? iter.ins : 0;
                addSection(resultSections, len, ins);
                if (ins > 0)
                    addInsert(resultInserted, resultSections, iter.text);
                iter.forward(len);
                pos += len;
            }
            let end = ranges[i++];
            while (pos < end) {
                if (iter.done)
                    break done;
                let len = Math.min(iter.len, end - pos);
                addSection(resultSections, len, -1);
                addSection(filteredSections, len, iter.ins == -1 ? -1 : iter.off == 0 ? iter.ins : 0);
                iter.forward(len);
                pos += len;
            }
        }
        return { changes: new ChangeSet(resultSections, resultInserted),
            filtered: ChangeDesc.create(filteredSections) };
    }
    /**
    Serialize this change set to a JSON-representable value.
    */
    toJSON() {
        let parts = [];
        for (let i = 0; i < this.sections.length; i += 2) {
            let len = this.sections[i], ins = this.sections[i + 1];
            if (ins < 0)
                parts.push(len);
            else if (ins == 0)
                parts.push([len]);
            else
                parts.push([len].concat(this.inserted[i >> 1].toJSON()));
        }
        return parts;
    }
    /**
    Create a change set for the given changes, for a document of the
    given length, using `lineSep` as line separator.
    */
    static of(changes, length, lineSep) {
        let sections = [], inserted = [], pos = 0;
        let total = null;
        function flush(force = false) {
            if (!force && !sections.length)
                return;
            if (pos < length)
                addSection(sections, length - pos, -1);
            let set = new ChangeSet(sections, inserted);
            total = total ? total.compose(set.map(total)) : set;
            sections = [];
            inserted = [];
            pos = 0;
        }
        function process(spec) {
            if (Array.isArray(spec)) {
                for (let sub of spec)
                    process(sub);
            }
            else if (spec instanceof ChangeSet) {
                if (spec.length != length)
                    throw new RangeError(`Mismatched change set length (got ${spec.length}, expected ${length})`);
                flush();
                total = total ? total.compose(spec.map(total)) : spec;
            }
            else {
                let { from, to = from, insert } = spec;
                if (from > to || from < 0 || to > length)
                    throw new RangeError(`Invalid change range ${from} to ${to} (in doc of length ${length})`);
                let insText = !insert ? Text.empty : typeof insert == "string" ? Text.of(insert.split(lineSep || DefaultSplit)) : insert;
                let insLen = insText.length;
                if (from == to && insLen == 0)
                    return;
                if (from < pos)
                    flush();
                if (from > pos)
                    addSection(sections, from - pos, -1);
                addSection(sections, to - from, insLen);
                addInsert(inserted, sections, insText);
                pos = to;
            }
        }
        process(changes);
        flush(!total);
        return total;
    }
    /**
    Create an empty changeset of the given length.
    */
    static empty(length) {
        return new ChangeSet(length ? [length, -1] : [], []);
    }
    /**
    Create a changeset from its JSON representation (as produced by
    [`toJSON`](https://codemirror.net/6/docs/ref/#state.ChangeSet.toJSON).
    */
    static fromJSON(json) {
        if (!Array.isArray(json))
            throw new RangeError("Invalid JSON representation of ChangeSet");
        let sections = [], inserted = [];
        for (let i = 0; i < json.length; i++) {
            let part = json[i];
            if (typeof part == "number") {
                sections.push(part, -1);
            }
            else if (!Array.isArray(part) || typeof part[0] != "number" || part.some((e, i) => i && typeof e != "string")) {
                throw new RangeError("Invalid JSON representation of ChangeSet");
            }
            else if (part.length == 1) {
                sections.push(part[0], 0);
            }
            else {
                while (inserted.length < i)
                    inserted.push(Text.empty);
                inserted[i] = Text.of(part.slice(1));
                sections.push(part[0], inserted[i].length);
            }
        }
        return new ChangeSet(sections, inserted);
    }
    /**
    @internal
    */
    static createSet(sections, inserted) {
        return new ChangeSet(sections, inserted);
    }
}
function addSection(sections, len, ins, forceJoin = false) {
    if (len == 0 && ins <= 0)
        return;
    let last = sections.length - 2;
    if (last >= 0 && ins <= 0 && ins == sections[last + 1])
        sections[last] += len;
    else if (len == 0 && sections[last] == 0)
        sections[last + 1] += ins;
    else if (forceJoin) {
        sections[last] += len;
        sections[last + 1] += ins;
    }
    else
        sections.push(len, ins);
}
function addInsert(values, sections, value) {
    if (value.length == 0)
        return;
    let index = (sections.length - 2) >> 1;
    if (index < values.length) {
        values[values.length - 1] = values[values.length - 1].append(value);
    }
    else {
        while (values.length < index)
            values.push(Text.empty);
        values.push(value);
    }
}
function iterChanges(desc, f, individual) {
    let inserted = desc.inserted;
    for (let posA = 0, posB = 0, i = 0; i < desc.sections.length;) {
        let len = desc.sections[i++], ins = desc.sections[i++];
        if (ins < 0) {
            posA += len;
            posB += len;
        }
        else {
            let endA = posA, endB = posB, text = Text.empty;
            for (;;) {
                endA += len;
                endB += ins;
                if (ins && inserted)
                    text = text.append(inserted[(i - 2) >> 1]);
                if (individual || i == desc.sections.length || desc.sections[i + 1] < 0)
                    break;
                len = desc.sections[i++];
                ins = desc.sections[i++];
            }
            f(posA, endA, posB, endB, text);
            posA = endA;
            posB = endB;
        }
    }
}
function mapSet(setA, setB, before, mkSet = false) {
    // Produce a copy of setA that applies to the document after setB
    // has been applied (assuming both start at the same document).
    let sections = [], insert = mkSet ? [] : null;
    let a = new SectionIter(setA), b = new SectionIter(setB);
    // Iterate over both sets in parallel. inserted tracks, for changes
    // in A that have to be processed piece-by-piece, whether their
    // content has been inserted already, and refers to the section
    // index.
    for (let inserted = -1;;) {
        if (a.ins == -1 && b.ins == -1) {
            // Move across ranges skipped by both sets.
            let len = Math.min(a.len, b.len);
            addSection(sections, len, -1);
            a.forward(len);
            b.forward(len);
        }
        else if (b.ins >= 0 && (a.ins < 0 || inserted == a.i || a.off == 0 && (b.len < a.len || b.len == a.len && !before))) {
            // If there's a change in B that comes before the next change in
            // A (ordered by start pos, then len, then before flag), skip
            // that (and process any changes in A it covers).
            let len = b.len;
            addSection(sections, b.ins, -1);
            while (len) {
                let piece = Math.min(a.len, len);
                if (a.ins >= 0 && inserted < a.i && a.len <= piece) {
                    addSection(sections, 0, a.ins);
                    if (insert)
                        addInsert(insert, sections, a.text);
                    inserted = a.i;
                }
                a.forward(piece);
                len -= piece;
            }
            b.next();
        }
        else if (a.ins >= 0) {
            // Process the part of a change in A up to the start of the next
            // non-deletion change in B (if overlapping).
            let len = 0, left = a.len;
            while (left) {
                if (b.ins == -1) {
                    let piece = Math.min(left, b.len);
                    len += piece;
                    left -= piece;
                    b.forward(piece);
                }
                else if (b.ins == 0 && b.len < left) {
                    left -= b.len;
                    b.next();
                }
                else {
                    break;
                }
            }
            addSection(sections, len, inserted < a.i ? a.ins : 0);
            if (insert && inserted < a.i)
                addInsert(insert, sections, a.text);
            inserted = a.i;
            a.forward(a.len - left);
        }
        else if (a.done && b.done) {
            return insert ? ChangeSet.createSet(sections, insert) : ChangeDesc.create(sections);
        }
        else {
            throw new Error("Mismatched change set lengths");
        }
    }
}
function composeSets(setA, setB, mkSet = false) {
    let sections = [];
    let insert = mkSet ? [] : null;
    let a = new SectionIter(setA), b = new SectionIter(setB);
    for (let open = false;;) {
        if (a.done && b.done) {
            return insert ? ChangeSet.createSet(sections, insert) : ChangeDesc.create(sections);
        }
        else if (a.ins == 0) { // Deletion in A
            addSection(sections, a.len, 0, open);
            a.next();
        }
        else if (b.len == 0 && !b.done) { // Insertion in B
            addSection(sections, 0, b.ins, open);
            if (insert)
                addInsert(insert, sections, b.text);
            b.next();
        }
        else if (a.done || b.done) {
            throw new Error("Mismatched change set lengths");
        }
        else {
            let len = Math.min(a.len2, b.len), sectionLen = sections.length;
            if (a.ins == -1) {
                let insB = b.ins == -1 ? -1 : b.off ? 0 : b.ins;
                addSection(sections, len, insB, open);
                if (insert && insB)
                    addInsert(insert, sections, b.text);
            }
            else if (b.ins == -1) {
                addSection(sections, a.off ? 0 : a.len, len, open);
                if (insert)
                    addInsert(insert, sections, a.textBit(len));
            }
            else {
                addSection(sections, a.off ? 0 : a.len, b.off ? 0 : b.ins, open);
                if (insert && !b.off)
                    addInsert(insert, sections, b.text);
            }
            open = (a.ins > len || b.ins >= 0 && b.len > len) && (open || sections.length > sectionLen);
            a.forward2(len);
            b.forward(len);
        }
    }
}
class SectionIter {
    constructor(set) {
        this.set = set;
        this.i = 0;
        this.next();
    }
    next() {
        let { sections } = this.set;
        if (this.i < sections.length) {
            this.len = sections[this.i++];
            this.ins = sections[this.i++];
        }
        else {
            this.len = 0;
            this.ins = -2;
        }
        this.off = 0;
    }
    get done() { return this.ins == -2; }
    get len2() { return this.ins < 0 ? this.len : this.ins; }
    get text() {
        let { inserted } = this.set, index = (this.i - 2) >> 1;
        return index >= inserted.length ? Text.empty : inserted[index];
    }
    textBit(len) {
        let { inserted } = this.set, index = (this.i - 2) >> 1;
        return index >= inserted.length && !len ? Text.empty
            : inserted[index].slice(this.off, len == null ? undefined : this.off + len);
    }
    forward(len) {
        if (len == this.len)
            this.next();
        else {
            this.len -= len;
            this.off += len;
        }
    }
    forward2(len) {
        if (this.ins == -1)
            this.forward(len);
        else if (len == this.ins)
            this.next();
        else {
            this.ins -= len;
            this.off += len;
        }
    }
}

/**
A single selection range. When
[`allowMultipleSelections`](https://codemirror.net/6/docs/ref/#state.EditorState^allowMultipleSelections)
is enabled, a [selection](https://codemirror.net/6/docs/ref/#state.EditorSelection) may hold
multiple ranges. By default, selections hold exactly one range.
*/
class SelectionRange {
    constructor(
    /**
    The lower boundary of the range.
    */
    from, 
    /**
    The upper boundary of the range.
    */
    to, flags) {
        this.from = from;
        this.to = to;
        this.flags = flags;
    }
    /**
    The anchor of the range—the side that doesn't move when you
    extend it.
    */
    get anchor() { return this.flags & 32 /* RangeFlag.Inverted */ ? this.to : this.from; }
    /**
    The head of the range, which is moved when the range is
    [extended](https://codemirror.net/6/docs/ref/#state.SelectionRange.extend).
    */
    get head() { return this.flags & 32 /* RangeFlag.Inverted */ ? this.from : this.to; }
    /**
    True when `anchor` and `head` are at the same position.
    */
    get empty() { return this.from == this.to; }
    /**
    If this is a cursor that is explicitly associated with the
    character on one of its sides, this returns the side. -1 means
    the character before its position, 1 the character after, and 0
    means no association.
    */
    get assoc() { return this.flags & 8 /* RangeFlag.AssocBefore */ ? -1 : this.flags & 16 /* RangeFlag.AssocAfter */ ? 1 : 0; }
    /**
    The bidirectional text level associated with this cursor, if
    any.
    */
    get bidiLevel() {
        let level = this.flags & 7 /* RangeFlag.BidiLevelMask */;
        return level == 7 ? null : level;
    }
    /**
    The goal column (stored vertical offset) associated with a
    cursor. This is used to preserve the vertical position when
    [moving](https://codemirror.net/6/docs/ref/#view.EditorView.moveVertically) across
    lines of different length.
    */
    get goalColumn() {
        let value = this.flags >> 6 /* RangeFlag.GoalColumnOffset */;
        return value == 16777215 /* RangeFlag.NoGoalColumn */ ? undefined : value;
    }
    /**
    Map this range through a change, producing a valid range in the
    updated document.
    */
    map(change, assoc = -1) {
        let from, to;
        if (this.empty) {
            from = to = change.mapPos(this.from, assoc);
        }
        else {
            from = change.mapPos(this.from, 1);
            to = change.mapPos(this.to, -1);
        }
        return from == this.from && to == this.to ? this : new SelectionRange(from, to, this.flags);
    }
    /**
    Extend this range to cover at least `from` to `to`.
    */
    extend(from, to = from) {
        if (from <= this.anchor && to >= this.anchor)
            return EditorSelection.range(from, to);
        let head = Math.abs(from - this.anchor) > Math.abs(to - this.anchor) ? from : to;
        return EditorSelection.range(this.anchor, head);
    }
    /**
    Compare this range to another range.
    */
    eq(other, includeAssoc = false) {
        return this.anchor == other.anchor && this.head == other.head &&
            (!includeAssoc || !this.empty || this.assoc == other.assoc);
    }
    /**
    Return a JSON-serializable object representing the range.
    */
    toJSON() { return { anchor: this.anchor, head: this.head }; }
    /**
    Convert a JSON representation of a range to a `SelectionRange`
    instance.
    */
    static fromJSON(json) {
        if (!json || typeof json.anchor != "number" || typeof json.head != "number")
            throw new RangeError("Invalid JSON representation for SelectionRange");
        return EditorSelection.range(json.anchor, json.head);
    }
    /**
    @internal
    */
    static create(from, to, flags) {
        return new SelectionRange(from, to, flags);
    }
}
/**
An editor selection holds one or more selection ranges.
*/
class EditorSelection {
    constructor(
    /**
    The ranges in the selection, sorted by position. Ranges cannot
    overlap (but they may touch, if they aren't empty).
    */
    ranges, 
    /**
    The index of the _main_ range in the selection (which is
    usually the range that was added last).
    */
    mainIndex) {
        this.ranges = ranges;
        this.mainIndex = mainIndex;
    }
    /**
    Map a selection through a change. Used to adjust the selection
    position for changes.
    */
    map(change, assoc = -1) {
        if (change.empty)
            return this;
        return EditorSelection.create(this.ranges.map(r => r.map(change, assoc)), this.mainIndex);
    }
    /**
    Compare this selection to another selection. By default, ranges
    are compared only by position. When `includeAssoc` is true,
    cursor ranges must also have the same
    [`assoc`](https://codemirror.net/6/docs/ref/#state.SelectionRange.assoc) value.
    */
    eq(other, includeAssoc = false) {
        if (this.ranges.length != other.ranges.length ||
            this.mainIndex != other.mainIndex)
            return false;
        for (let i = 0; i < this.ranges.length; i++)
            if (!this.ranges[i].eq(other.ranges[i], includeAssoc))
                return false;
        return true;
    }
    /**
    Get the primary selection range. Usually, you should make sure
    your code applies to _all_ ranges, by using methods like
    [`changeByRange`](https://codemirror.net/6/docs/ref/#state.EditorState.changeByRange).
    */
    get main() { return this.ranges[this.mainIndex]; }
    /**
    Make sure the selection only has one range. Returns a selection
    holding only the main range from this selection.
    */
    asSingle() {
        return this.ranges.length == 1 ? this : new EditorSelection([this.main], 0);
    }
    /**
    Extend this selection with an extra range.
    */
    addRange(range, main = true) {
        return EditorSelection.create([range].concat(this.ranges), main ? 0 : this.mainIndex + 1);
    }
    /**
    Replace a given range with another range, and then normalize the
    selection to merge and sort ranges if necessary.
    */
    replaceRange(range, which = this.mainIndex) {
        let ranges = this.ranges.slice();
        ranges[which] = range;
        return EditorSelection.create(ranges, this.mainIndex);
    }
    /**
    Convert this selection to an object that can be serialized to
    JSON.
    */
    toJSON() {
        return { ranges: this.ranges.map(r => r.toJSON()), main: this.mainIndex };
    }
    /**
    Create a selection from a JSON representation.
    */
    static fromJSON(json) {
        if (!json || !Array.isArray(json.ranges) || typeof json.main != "number" || json.main >= json.ranges.length)
            throw new RangeError("Invalid JSON representation for EditorSelection");
        return new EditorSelection(json.ranges.map((r) => SelectionRange.fromJSON(r)), json.main);
    }
    /**
    Create a selection holding a single range.
    */
    static single(anchor, head = anchor) {
        return new EditorSelection([EditorSelection.range(anchor, head)], 0);
    }
    /**
    Sort and merge the given set of ranges, creating a valid
    selection.
    */
    static create(ranges, mainIndex = 0) {
        if (ranges.length == 0)
            throw new RangeError("A selection needs at least one range");
        for (let pos = 0, i = 0; i < ranges.length; i++) {
            let range = ranges[i];
            if (range.empty ? range.from <= pos : range.from < pos)
                return EditorSelection.normalized(ranges.slice(), mainIndex);
            pos = range.to;
        }
        return new EditorSelection(ranges, mainIndex);
    }
    /**
    Create a cursor selection range at the given position. You can
    safely ignore the optional arguments in most situations.
    */
    static cursor(pos, assoc = 0, bidiLevel, goalColumn) {
        return SelectionRange.create(pos, pos, (assoc == 0 ? 0 : assoc < 0 ? 8 /* RangeFlag.AssocBefore */ : 16 /* RangeFlag.AssocAfter */) |
            (bidiLevel == null ? 7 : Math.min(6, bidiLevel)) |
            ((goalColumn !== null && goalColumn !== void 0 ? goalColumn : 16777215 /* RangeFlag.NoGoalColumn */) << 6 /* RangeFlag.GoalColumnOffset */));
    }
    /**
    Create a selection range.
    */
    static range(anchor, head, goalColumn, bidiLevel) {
        let flags = ((goalColumn !== null && goalColumn !== void 0 ? goalColumn : 16777215 /* RangeFlag.NoGoalColumn */) << 6 /* RangeFlag.GoalColumnOffset */) |
            (bidiLevel == null ? 7 : Math.min(6, bidiLevel));
        return head < anchor ? SelectionRange.create(head, anchor, 32 /* RangeFlag.Inverted */ | 16 /* RangeFlag.AssocAfter */ | flags)
            : SelectionRange.create(anchor, head, (head > anchor ? 8 /* RangeFlag.AssocBefore */ : 0) | flags);
    }
    /**
    @internal
    */
    static normalized(ranges, mainIndex = 0) {
        let main = ranges[mainIndex];
        ranges.sort((a, b) => a.from - b.from);
        mainIndex = ranges.indexOf(main);
        for (let i = 1; i < ranges.length; i++) {
            let range = ranges[i], prev = ranges[i - 1];
            if (range.empty ? range.from <= prev.to : range.from < prev.to) {
                let from = prev.from, to = Math.max(range.to, prev.to);
                if (i <= mainIndex)
                    mainIndex--;
                ranges.splice(--i, 2, range.anchor > range.head ? EditorSelection.range(to, from) : EditorSelection.range(from, to));
            }
        }
        return new EditorSelection(ranges, mainIndex);
    }
}
function checkSelection(selection, docLength) {
    for (let range of selection.ranges)
        if (range.to > docLength)
            throw new RangeError("Selection points outside of document");
}

let nextID = 0;
/**
A facet is a labeled value that is associated with an editor
state. It takes inputs from any number of extensions, and combines
those into a single output value.

Examples of uses of facets are the [tab
size](https://codemirror.net/6/docs/ref/#state.EditorState^tabSize), [editor
attributes](https://codemirror.net/6/docs/ref/#view.EditorView^editorAttributes), and [update
listeners](https://codemirror.net/6/docs/ref/#view.EditorView^updateListener).

Note that `Facet` instances can be used anywhere where
[`FacetReader`](https://codemirror.net/6/docs/ref/#state.FacetReader) is expected.
*/
class Facet {
    constructor(
    /**
    @internal
    */
    combine, 
    /**
    @internal
    */
    compareInput, 
    /**
    @internal
    */
    compare, isStatic, enables) {
        this.combine = combine;
        this.compareInput = compareInput;
        this.compare = compare;
        this.isStatic = isStatic;
        /**
        @internal
        */
        this.id = nextID++;
        this.default = combine([]);
        this.extensions = typeof enables == "function" ? enables(this) : enables;
    }
    /**
    Returns a facet reader for this facet, which can be used to
    [read](https://codemirror.net/6/docs/ref/#state.EditorState.facet) it but not to define values for it.
    */
    get reader() { return this; }
    /**
    Define a new facet.
    */
    static define(config = {}) {
        return new Facet(config.combine || ((a) => a), config.compareInput || ((a, b) => a === b), config.compare || (!config.combine ? sameArray$1 : (a, b) => a === b), !!config.static, config.enables);
    }
    /**
    Returns an extension that adds the given value to this facet.
    */
    of(value) {
        return new FacetProvider([], this, 0 /* Provider.Static */, value);
    }
    /**
    Create an extension that computes a value for the facet from a
    state. You must take care to declare the parts of the state that
    this value depends on, since your function is only called again
    for a new state when one of those parts changed.
    
    In cases where your value depends only on a single field, you'll
    want to use the [`from`](https://codemirror.net/6/docs/ref/#state.Facet.from) method instead.
    */
    compute(deps, get) {
        if (this.isStatic)
            throw new Error("Can't compute a static facet");
        return new FacetProvider(deps, this, 1 /* Provider.Single */, get);
    }
    /**
    Create an extension that computes zero or more values for this
    facet from a state.
    */
    computeN(deps, get) {
        if (this.isStatic)
            throw new Error("Can't compute a static facet");
        return new FacetProvider(deps, this, 2 /* Provider.Multi */, get);
    }
    from(field, get) {
        if (!get)
            get = x => x;
        return this.compute([field], state => get(state.field(field)));
    }
}
function sameArray$1(a, b) {
    return a == b || a.length == b.length && a.every((e, i) => e === b[i]);
}
class FacetProvider {
    constructor(dependencies, facet, type, value) {
        this.dependencies = dependencies;
        this.facet = facet;
        this.type = type;
        this.value = value;
        this.id = nextID++;
    }
    dynamicSlot(addresses) {
        var _a;
        let getter = this.value;
        let compare = this.facet.compareInput;
        let id = this.id, idx = addresses[id] >> 1, multi = this.type == 2 /* Provider.Multi */;
        let depDoc = false, depSel = false, depAddrs = [];
        for (let dep of this.dependencies) {
            if (dep == "doc")
                depDoc = true;
            else if (dep == "selection")
                depSel = true;
            else if ((((_a = addresses[dep.id]) !== null && _a !== void 0 ? _a : 1) & 1) == 0)
                depAddrs.push(addresses[dep.id]);
        }
        return {
            create(state) {
                state.values[idx] = getter(state);
                return 1 /* SlotStatus.Changed */;
            },
            update(state, tr) {
                if ((depDoc && tr.docChanged) || (depSel && (tr.docChanged || tr.selection)) || ensureAll(state, depAddrs)) {
                    let newVal = getter(state);
                    if (multi ? !compareArray(newVal, state.values[idx], compare) : !compare(newVal, state.values[idx])) {
                        state.values[idx] = newVal;
                        return 1 /* SlotStatus.Changed */;
                    }
                }
                return 0;
            },
            reconfigure: (state, oldState) => {
                let newVal, oldAddr = oldState.config.address[id];
                if (oldAddr != null) {
                    let oldVal = getAddr(oldState, oldAddr);
                    if (this.dependencies.every(dep => {
                        return dep instanceof Facet ? oldState.facet(dep) === state.facet(dep) :
                            dep instanceof StateField ? oldState.field(dep, false) == state.field(dep, false) : true;
                    }) || (multi ? compareArray(newVal = getter(state), oldVal, compare) : compare(newVal = getter(state), oldVal))) {
                        state.values[idx] = oldVal;
                        return 0;
                    }
                }
                else {
                    newVal = getter(state);
                }
                state.values[idx] = newVal;
                return 1 /* SlotStatus.Changed */;
            }
        };
    }
}
function compareArray(a, b, compare) {
    if (a.length != b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (!compare(a[i], b[i]))
            return false;
    return true;
}
function ensureAll(state, addrs) {
    let changed = false;
    for (let addr of addrs)
        if (ensureAddr(state, addr) & 1 /* SlotStatus.Changed */)
            changed = true;
    return changed;
}
function dynamicFacetSlot(addresses, facet, providers) {
    let providerAddrs = providers.map(p => addresses[p.id]);
    let providerTypes = providers.map(p => p.type);
    let dynamic = providerAddrs.filter(p => !(p & 1));
    let idx = addresses[facet.id] >> 1;
    function get(state) {
        let values = [];
        for (let i = 0; i < providerAddrs.length; i++) {
            let value = getAddr(state, providerAddrs[i]);
            if (providerTypes[i] == 2 /* Provider.Multi */)
                for (let val of value)
                    values.push(val);
            else
                values.push(value);
        }
        return facet.combine(values);
    }
    return {
        create(state) {
            for (let addr of providerAddrs)
                ensureAddr(state, addr);
            state.values[idx] = get(state);
            return 1 /* SlotStatus.Changed */;
        },
        update(state, tr) {
            if (!ensureAll(state, dynamic))
                return 0;
            let value = get(state);
            if (facet.compare(value, state.values[idx]))
                return 0;
            state.values[idx] = value;
            return 1 /* SlotStatus.Changed */;
        },
        reconfigure(state, oldState) {
            let depChanged = ensureAll(state, providerAddrs);
            let oldProviders = oldState.config.facets[facet.id], oldValue = oldState.facet(facet);
            if (oldProviders && !depChanged && sameArray$1(providers, oldProviders)) {
                state.values[idx] = oldValue;
                return 0;
            }
            let value = get(state);
            if (facet.compare(value, oldValue)) {
                state.values[idx] = oldValue;
                return 0;
            }
            state.values[idx] = value;
            return 1 /* SlotStatus.Changed */;
        }
    };
}
const initField = /*@__PURE__*/Facet.define({ static: true });
/**
Fields can store additional information in an editor state, and
keep it in sync with the rest of the state.
*/
class StateField {
    constructor(
    /**
    @internal
    */
    id, createF, updateF, compareF, 
    /**
    @internal
    */
    spec) {
        this.id = id;
        this.createF = createF;
        this.updateF = updateF;
        this.compareF = compareF;
        this.spec = spec;
        /**
        @internal
        */
        this.provides = undefined;
    }
    /**
    Define a state field.
    */
    static define(config) {
        let field = new StateField(nextID++, config.create, config.update, config.compare || ((a, b) => a === b), config);
        if (config.provide)
            field.provides = config.provide(field);
        return field;
    }
    create(state) {
        let init = state.facet(initField).find(i => i.field == this);
        return ((init === null || init === void 0 ? void 0 : init.create) || this.createF)(state);
    }
    /**
    @internal
    */
    slot(addresses) {
        let idx = addresses[this.id] >> 1;
        return {
            create: (state) => {
                state.values[idx] = this.create(state);
                return 1 /* SlotStatus.Changed */;
            },
            update: (state, tr) => {
                let oldVal = state.values[idx];
                let value = this.updateF(oldVal, tr);
                if (this.compareF(oldVal, value))
                    return 0;
                state.values[idx] = value;
                return 1 /* SlotStatus.Changed */;
            },
            reconfigure: (state, oldState) => {
                if (oldState.config.address[this.id] != null) {
                    state.values[idx] = oldState.field(this);
                    return 0;
                }
                state.values[idx] = this.create(state);
                return 1 /* SlotStatus.Changed */;
            }
        };
    }
    /**
    Returns an extension that enables this field and overrides the
    way it is initialized. Can be useful when you need to provide a
    non-default starting value for the field.
    */
    init(create) {
        return [this, initField.of({ field: this, create })];
    }
    /**
    State field instances can be used as
    [`Extension`](https://codemirror.net/6/docs/ref/#state.Extension) values to enable the field in a
    given state.
    */
    get extension() { return this; }
}
const Prec_ = { lowest: 4, low: 3, default: 2, high: 1, highest: 0 };
function prec(value) {
    return (ext) => new PrecExtension(ext, value);
}
/**
By default extensions are registered in the order they are found
in the flattened form of nested array that was provided.
Individual extension values can be assigned a precedence to
override this. Extensions that do not have a precedence set get
the precedence of the nearest parent with a precedence, or
[`default`](https://codemirror.net/6/docs/ref/#state.Prec.default) if there is no such parent. The
final ordering of extensions is determined by first sorting by
precedence and then by order within each precedence.
*/
const Prec = {
    /**
    The highest precedence level, for extensions that should end up
    near the start of the precedence ordering.
    */
    highest: /*@__PURE__*/prec(Prec_.highest),
    /**
    A higher-than-default precedence, for extensions that should
    come before those with default precedence.
    */
    high: /*@__PURE__*/prec(Prec_.high),
    /**
    The default precedence, which is also used for extensions
    without an explicit precedence.
    */
    default: /*@__PURE__*/prec(Prec_.default),
    /**
    A lower-than-default precedence.
    */
    low: /*@__PURE__*/prec(Prec_.low),
    /**
    The lowest precedence level. Meant for things that should end up
    near the end of the extension order.
    */
    lowest: /*@__PURE__*/prec(Prec_.lowest)
};
class PrecExtension {
    constructor(inner, prec) {
        this.inner = inner;
        this.prec = prec;
    }
}
/**
Extension compartments can be used to make a configuration
dynamic. By [wrapping](https://codemirror.net/6/docs/ref/#state.Compartment.of) part of your
configuration in a compartment, you can later
[replace](https://codemirror.net/6/docs/ref/#state.Compartment.reconfigure) that part through a
transaction.
*/
class Compartment {
    /**
    Create an instance of this compartment to add to your [state
    configuration](https://codemirror.net/6/docs/ref/#state.EditorStateConfig.extensions).
    */
    of(ext) { return new CompartmentInstance(this, ext); }
    /**
    Create an [effect](https://codemirror.net/6/docs/ref/#state.TransactionSpec.effects) that
    reconfigures this compartment.
    */
    reconfigure(content) {
        return Compartment.reconfigure.of({ compartment: this, extension: content });
    }
    /**
    Get the current content of the compartment in the state, or
    `undefined` if it isn't present.
    */
    get(state) {
        return state.config.compartments.get(this);
    }
}
class CompartmentInstance {
    constructor(compartment, inner) {
        this.compartment = compartment;
        this.inner = inner;
    }
}
class Configuration {
    constructor(base, compartments, dynamicSlots, address, staticValues, facets) {
        this.base = base;
        this.compartments = compartments;
        this.dynamicSlots = dynamicSlots;
        this.address = address;
        this.staticValues = staticValues;
        this.facets = facets;
        this.statusTemplate = [];
        while (this.statusTemplate.length < dynamicSlots.length)
            this.statusTemplate.push(0 /* SlotStatus.Unresolved */);
    }
    staticFacet(facet) {
        let addr = this.address[facet.id];
        return addr == null ? facet.default : this.staticValues[addr >> 1];
    }
    static resolve(base, compartments, oldState) {
        let fields = [];
        let facets = Object.create(null);
        let newCompartments = new Map();
        for (let ext of flatten(base, compartments, newCompartments)) {
            if (ext instanceof StateField)
                fields.push(ext);
            else
                (facets[ext.facet.id] || (facets[ext.facet.id] = [])).push(ext);
        }
        let address = Object.create(null);
        let staticValues = [];
        let dynamicSlots = [];
        for (let field of fields) {
            address[field.id] = dynamicSlots.length << 1;
            dynamicSlots.push(a => field.slot(a));
        }
        let oldFacets = oldState === null || oldState === void 0 ? void 0 : oldState.config.facets;
        for (let id in facets) {
            let providers = facets[id], facet = providers[0].facet;
            let oldProviders = oldFacets && oldFacets[id] || [];
            if (providers.every(p => p.type == 0 /* Provider.Static */)) {
                address[facet.id] = (staticValues.length << 1) | 1;
                if (sameArray$1(oldProviders, providers)) {
                    staticValues.push(oldState.facet(facet));
                }
                else {
                    let value = facet.combine(providers.map(p => p.value));
                    staticValues.push(oldState && facet.compare(value, oldState.facet(facet)) ? oldState.facet(facet) : value);
                }
            }
            else {
                for (let p of providers) {
                    if (p.type == 0 /* Provider.Static */) {
                        address[p.id] = (staticValues.length << 1) | 1;
                        staticValues.push(p.value);
                    }
                    else {
                        address[p.id] = dynamicSlots.length << 1;
                        dynamicSlots.push(a => p.dynamicSlot(a));
                    }
                }
                address[facet.id] = dynamicSlots.length << 1;
                dynamicSlots.push(a => dynamicFacetSlot(a, facet, providers));
            }
        }
        let dynamic = dynamicSlots.map(f => f(address));
        return new Configuration(base, newCompartments, dynamic, address, staticValues, facets);
    }
}
function flatten(extension, compartments, newCompartments) {
    let result = [[], [], [], [], []];
    let seen = new Map();
    function inner(ext, prec) {
        let known = seen.get(ext);
        if (known != null) {
            if (known <= prec)
                return;
            let found = result[known].indexOf(ext);
            if (found > -1)
                result[known].splice(found, 1);
            if (ext instanceof CompartmentInstance)
                newCompartments.delete(ext.compartment);
        }
        seen.set(ext, prec);
        if (Array.isArray(ext)) {
            for (let e of ext)
                inner(e, prec);
        }
        else if (ext instanceof CompartmentInstance) {
            if (newCompartments.has(ext.compartment))
                throw new RangeError(`Duplicate use of compartment in extensions`);
            let content = compartments.get(ext.compartment) || ext.inner;
            newCompartments.set(ext.compartment, content);
            inner(content, prec);
        }
        else if (ext instanceof PrecExtension) {
            inner(ext.inner, ext.prec);
        }
        else if (ext instanceof StateField) {
            result[prec].push(ext);
            if (ext.provides)
                inner(ext.provides, prec);
        }
        else if (ext instanceof FacetProvider) {
            result[prec].push(ext);
            if (ext.facet.extensions)
                inner(ext.facet.extensions, Prec_.default);
        }
        else {
            let content = ext.extension;
            if (!content)
                throw new Error(`Unrecognized extension value in extension set (${ext}). This sometimes happens because multiple instances of @codemirror/state are loaded, breaking instanceof checks.`);
            inner(content, prec);
        }
    }
    inner(extension, Prec_.default);
    return result.reduce((a, b) => a.concat(b));
}
function ensureAddr(state, addr) {
    if (addr & 1)
        return 2 /* SlotStatus.Computed */;
    let idx = addr >> 1;
    let status = state.status[idx];
    if (status == 4 /* SlotStatus.Computing */)
        throw new Error("Cyclic dependency between fields and/or facets");
    if (status & 2 /* SlotStatus.Computed */)
        return status;
    state.status[idx] = 4 /* SlotStatus.Computing */;
    let changed = state.computeSlot(state, state.config.dynamicSlots[idx]);
    return state.status[idx] = 2 /* SlotStatus.Computed */ | changed;
}
function getAddr(state, addr) {
    return addr & 1 ? state.config.staticValues[addr >> 1] : state.values[addr >> 1];
}

const languageData = /*@__PURE__*/Facet.define();
const allowMultipleSelections = /*@__PURE__*/Facet.define({
    combine: values => values.some(v => v),
    static: true
});
const lineSeparator = /*@__PURE__*/Facet.define({
    combine: values => values.length ? values[0] : undefined,
    static: true
});
const changeFilter = /*@__PURE__*/Facet.define();
const transactionFilter = /*@__PURE__*/Facet.define();
const transactionExtender = /*@__PURE__*/Facet.define();
const readOnly = /*@__PURE__*/Facet.define({
    combine: values => values.length ? values[0] : false
});

/**
Annotations are tagged values that are used to add metadata to
transactions in an extensible way. They should be used to model
things that effect the entire transaction (such as its [time
stamp](https://codemirror.net/6/docs/ref/#state.Transaction^time) or information about its
[origin](https://codemirror.net/6/docs/ref/#state.Transaction^userEvent)). For effects that happen
_alongside_ the other changes made by the transaction, [state
effects](https://codemirror.net/6/docs/ref/#state.StateEffect) are more appropriate.
*/
class Annotation {
    /**
    @internal
    */
    constructor(
    /**
    The annotation type.
    */
    type, 
    /**
    The value of this annotation.
    */
    value) {
        this.type = type;
        this.value = value;
    }
    /**
    Define a new type of annotation.
    */
    static define() { return new AnnotationType(); }
}
/**
Marker that identifies a type of [annotation](https://codemirror.net/6/docs/ref/#state.Annotation).
*/
class AnnotationType {
    /**
    Create an instance of this annotation.
    */
    of(value) { return new Annotation(this, value); }
}
/**
Representation of a type of state effect. Defined with
[`StateEffect.define`](https://codemirror.net/6/docs/ref/#state.StateEffect^define).
*/
class StateEffectType {
    /**
    @internal
    */
    constructor(
    // The `any` types in these function types are there to work
    // around TypeScript issue #37631, where the type guard on
    // `StateEffect.is` mysteriously stops working when these properly
    // have type `Value`.
    /**
    @internal
    */
    map) {
        this.map = map;
    }
    /**
    Create a [state effect](https://codemirror.net/6/docs/ref/#state.StateEffect) instance of this
    type.
    */
    of(value) { return new StateEffect(this, value); }
}
/**
State effects can be used to represent additional effects
associated with a [transaction](https://codemirror.net/6/docs/ref/#state.Transaction.effects). They
are often useful to model changes to custom [state
fields](https://codemirror.net/6/docs/ref/#state.StateField), when those changes aren't implicit in
document or selection changes.
*/
class StateEffect {
    /**
    @internal
    */
    constructor(
    /**
    @internal
    */
    type, 
    /**
    The value of this effect.
    */
    value) {
        this.type = type;
        this.value = value;
    }
    /**
    Map this effect through a position mapping. Will return
    `undefined` when that ends up deleting the effect.
    */
    map(mapping) {
        let mapped = this.type.map(this.value, mapping);
        return mapped === undefined ? undefined : mapped == this.value ? this : new StateEffect(this.type, mapped);
    }
    /**
    Tells you whether this effect object is of a given
    [type](https://codemirror.net/6/docs/ref/#state.StateEffectType).
    */
    is(type) { return this.type == type; }
    /**
    Define a new effect type. The type parameter indicates the type
    of values that his effect holds. It should be a type that
    doesn't include `undefined`, since that is used in
    [mapping](https://codemirror.net/6/docs/ref/#state.StateEffect.map) to indicate that an effect is
    removed.
    */
    static define(spec = {}) {
        return new StateEffectType(spec.map || (v => v));
    }
    /**
    Map an array of effects through a change set.
    */
    static mapEffects(effects, mapping) {
        if (!effects.length)
            return effects;
        let result = [];
        for (let effect of effects) {
            let mapped = effect.map(mapping);
            if (mapped)
                result.push(mapped);
        }
        return result;
    }
}
/**
This effect can be used to reconfigure the root extensions of
the editor. Doing this will discard any extensions
[appended](https://codemirror.net/6/docs/ref/#state.StateEffect^appendConfig), but does not reset
the content of [reconfigured](https://codemirror.net/6/docs/ref/#state.Compartment.reconfigure)
compartments.
*/
StateEffect.reconfigure = /*@__PURE__*/StateEffect.define();
/**
Append extensions to the top-level configuration of the editor.
*/
StateEffect.appendConfig = /*@__PURE__*/StateEffect.define();
/**
Changes to the editor state are grouped into transactions.
Typically, a user action creates a single transaction, which may
contain any number of document changes, may change the selection,
or have other effects. Create a transaction by calling
[`EditorState.update`](https://codemirror.net/6/docs/ref/#state.EditorState.update), or immediately
dispatch one by calling
[`EditorView.dispatch`](https://codemirror.net/6/docs/ref/#view.EditorView.dispatch).
*/
class Transaction {
    constructor(
    /**
    The state from which the transaction starts.
    */
    startState, 
    /**
    The document changes made by this transaction.
    */
    changes, 
    /**
    The selection set by this transaction, or undefined if it
    doesn't explicitly set a selection.
    */
    selection, 
    /**
    The effects added to the transaction.
    */
    effects, 
    /**
    @internal
    */
    annotations, 
    /**
    Whether the selection should be scrolled into view after this
    transaction is dispatched.
    */
    scrollIntoView) {
        this.startState = startState;
        this.changes = changes;
        this.selection = selection;
        this.effects = effects;
        this.annotations = annotations;
        this.scrollIntoView = scrollIntoView;
        /**
        @internal
        */
        this._doc = null;
        /**
        @internal
        */
        this._state = null;
        if (selection)
            checkSelection(selection, changes.newLength);
        if (!annotations.some((a) => a.type == Transaction.time))
            this.annotations = annotations.concat(Transaction.time.of(Date.now()));
    }
    /**
    @internal
    */
    static create(startState, changes, selection, effects, annotations, scrollIntoView) {
        return new Transaction(startState, changes, selection, effects, annotations, scrollIntoView);
    }
    /**
    The new document produced by the transaction. Contrary to
    [`.state`](https://codemirror.net/6/docs/ref/#state.Transaction.state)`.doc`, accessing this won't
    force the entire new state to be computed right away, so it is
    recommended that [transaction
    filters](https://codemirror.net/6/docs/ref/#state.EditorState^transactionFilter) use this getter
    when they need to look at the new document.
    */
    get newDoc() {
        return this._doc || (this._doc = this.changes.apply(this.startState.doc));
    }
    /**
    The new selection produced by the transaction. If
    [`this.selection`](https://codemirror.net/6/docs/ref/#state.Transaction.selection) is undefined,
    this will [map](https://codemirror.net/6/docs/ref/#state.EditorSelection.map) the start state's
    current selection through the changes made by the transaction.
    */
    get newSelection() {
        return this.selection || this.startState.selection.map(this.changes);
    }
    /**
    The new state created by the transaction. Computed on demand
    (but retained for subsequent access), so it is recommended not to
    access it in [transaction
    filters](https://codemirror.net/6/docs/ref/#state.EditorState^transactionFilter) when possible.
    */
    get state() {
        if (!this._state)
            this.startState.applyTransaction(this);
        return this._state;
    }
    /**
    Get the value of the given annotation type, if any.
    */
    annotation(type) {
        for (let ann of this.annotations)
            if (ann.type == type)
                return ann.value;
        return undefined;
    }
    /**
    Indicates whether the transaction changed the document.
    */
    get docChanged() { return !this.changes.empty; }
    /**
    Indicates whether this transaction reconfigures the state
    (through a [configuration compartment](https://codemirror.net/6/docs/ref/#state.Compartment) or
    with a top-level configuration
    [effect](https://codemirror.net/6/docs/ref/#state.StateEffect^reconfigure).
    */
    get reconfigured() { return this.startState.config != this.state.config; }
    /**
    Returns true if the transaction has a [user
    event](https://codemirror.net/6/docs/ref/#state.Transaction^userEvent) annotation that is equal to
    or more specific than `event`. For example, if the transaction
    has `"select.pointer"` as user event, `"select"` and
    `"select.pointer"` will match it.
    */
    isUserEvent(event) {
        let e = this.annotation(Transaction.userEvent);
        return !!(e && (e == event || e.length > event.length && e.slice(0, event.length) == event && e[event.length] == "."));
    }
}
/**
Annotation used to store transaction timestamps. Automatically
added to every transaction, holding `Date.now()`.
*/
Transaction.time = /*@__PURE__*/Annotation.define();
/**
Annotation used to associate a transaction with a user interface
event. Holds a string identifying the event, using a
dot-separated format to support attaching more specific
information. The events used by the core libraries are:

 - `"input"` when content is entered
   - `"input.type"` for typed input
     - `"input.type.compose"` for composition
   - `"input.paste"` for pasted input
   - `"input.drop"` when adding content with drag-and-drop
   - `"input.complete"` when autocompleting
 - `"delete"` when the user deletes content
   - `"delete.selection"` when deleting the selection
   - `"delete.forward"` when deleting forward from the selection
   - `"delete.backward"` when deleting backward from the selection
   - `"delete.cut"` when cutting to the clipboard
 - `"move"` when content is moved
   - `"move.drop"` when content is moved within the editor through drag-and-drop
 - `"select"` when explicitly changing the selection
   - `"select.pointer"` when selecting with a mouse or other pointing device
 - `"undo"` and `"redo"` for history actions

Use [`isUserEvent`](https://codemirror.net/6/docs/ref/#state.Transaction.isUserEvent) to check
whether the annotation matches a given event.
*/
Transaction.userEvent = /*@__PURE__*/Annotation.define();
/**
Annotation indicating whether a transaction should be added to
the undo history or not.
*/
Transaction.addToHistory = /*@__PURE__*/Annotation.define();
/**
Annotation indicating (when present and true) that a transaction
represents a change made by some other actor, not the user. This
is used, for example, to tag other people's changes in
collaborative editing.
*/
Transaction.remote = /*@__PURE__*/Annotation.define();
function joinRanges(a, b) {
    let result = [];
    for (let iA = 0, iB = 0;;) {
        let from, to;
        if (iA < a.length && (iB == b.length || b[iB] >= a[iA])) {
            from = a[iA++];
            to = a[iA++];
        }
        else if (iB < b.length) {
            from = b[iB++];
            to = b[iB++];
        }
        else
            return result;
        if (!result.length || result[result.length - 1] < from)
            result.push(from, to);
        else if (result[result.length - 1] < to)
            result[result.length - 1] = to;
    }
}
function mergeTransaction(a, b, sequential) {
    var _a;
    let mapForA, mapForB, changes;
    if (sequential) {
        mapForA = b.changes;
        mapForB = ChangeSet.empty(b.changes.length);
        changes = a.changes.compose(b.changes);
    }
    else {
        mapForA = b.changes.map(a.changes);
        mapForB = a.changes.mapDesc(b.changes, true);
        changes = a.changes.compose(mapForA);
    }
    return {
        changes,
        selection: b.selection ? b.selection.map(mapForB) : (_a = a.selection) === null || _a === void 0 ? void 0 : _a.map(mapForA),
        effects: StateEffect.mapEffects(a.effects, mapForA).concat(StateEffect.mapEffects(b.effects, mapForB)),
        annotations: a.annotations.length ? a.annotations.concat(b.annotations) : b.annotations,
        scrollIntoView: a.scrollIntoView || b.scrollIntoView
    };
}
function resolveTransactionInner(state, spec, docSize) {
    let sel = spec.selection, annotations = asArray$1(spec.annotations);
    if (spec.userEvent)
        annotations = annotations.concat(Transaction.userEvent.of(spec.userEvent));
    return {
        changes: spec.changes instanceof ChangeSet ? spec.changes
            : ChangeSet.of(spec.changes || [], docSize, state.facet(lineSeparator)),
        selection: sel && (sel instanceof EditorSelection ? sel : EditorSelection.single(sel.anchor, sel.head)),
        effects: asArray$1(spec.effects),
        annotations,
        scrollIntoView: !!spec.scrollIntoView
    };
}
function resolveTransaction(state, specs, filter) {
    let s = resolveTransactionInner(state, specs.length ? specs[0] : {}, state.doc.length);
    if (specs.length && specs[0].filter === false)
        filter = false;
    for (let i = 1; i < specs.length; i++) {
        if (specs[i].filter === false)
            filter = false;
        let seq = !!specs[i].sequential;
        s = mergeTransaction(s, resolveTransactionInner(state, specs[i], seq ? s.changes.newLength : state.doc.length), seq);
    }
    let tr = Transaction.create(state, s.changes, s.selection, s.effects, s.annotations, s.scrollIntoView);
    return extendTransaction(filter ? filterTransaction(tr) : tr);
}
// Finish a transaction by applying filters if necessary.
function filterTransaction(tr) {
    let state = tr.startState;
    // Change filters
    let result = true;
    for (let filter of state.facet(changeFilter)) {
        let value = filter(tr);
        if (value === false) {
            result = false;
            break;
        }
        if (Array.isArray(value))
            result = result === true ? value : joinRanges(result, value);
    }
    if (result !== true) {
        let changes, back;
        if (result === false) {
            back = tr.changes.invertedDesc;
            changes = ChangeSet.empty(state.doc.length);
        }
        else {
            let filtered = tr.changes.filter(result);
            changes = filtered.changes;
            back = filtered.filtered.mapDesc(filtered.changes).invertedDesc;
        }
        tr = Transaction.create(state, changes, tr.selection && tr.selection.map(back), StateEffect.mapEffects(tr.effects, back), tr.annotations, tr.scrollIntoView);
    }
    // Transaction filters
    let filters = state.facet(transactionFilter);
    for (let i = filters.length - 1; i >= 0; i--) {
        let filtered = filters[i](tr);
        if (filtered instanceof Transaction)
            tr = filtered;
        else if (Array.isArray(filtered) && filtered.length == 1 && filtered[0] instanceof Transaction)
            tr = filtered[0];
        else
            tr = resolveTransaction(state, asArray$1(filtered), false);
    }
    return tr;
}
function extendTransaction(tr) {
    let state = tr.startState, extenders = state.facet(transactionExtender), spec = tr;
    for (let i = extenders.length - 1; i >= 0; i--) {
        let extension = extenders[i](tr);
        if (extension && Object.keys(extension).length)
            spec = mergeTransaction(spec, resolveTransactionInner(state, extension, tr.changes.newLength), true);
    }
    return spec == tr ? tr : Transaction.create(state, tr.changes, tr.selection, spec.effects, spec.annotations, spec.scrollIntoView);
}
const none$1 = [];
function asArray$1(value) {
    return value == null ? none$1 : Array.isArray(value) ? value : [value];
}

/**
The categories produced by a [character
categorizer](https://codemirror.net/6/docs/ref/#state.EditorState.charCategorizer). These are used
do things like selecting by word.
*/
var CharCategory = /*@__PURE__*/(function (CharCategory) {
    /**
    Word characters.
    */
    CharCategory[CharCategory["Word"] = 0] = "Word";
    /**
    Whitespace.
    */
    CharCategory[CharCategory["Space"] = 1] = "Space";
    /**
    Anything else.
    */
    CharCategory[CharCategory["Other"] = 2] = "Other";
return CharCategory})(CharCategory || (CharCategory = {}));
const nonASCIISingleCaseWordChar = /[\u00df\u0587\u0590-\u05f4\u0600-\u06ff\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc\uac00-\ud7af]/;
let wordChar;
try {
    wordChar = /*@__PURE__*/new RegExp("[\\p{Alphabetic}\\p{Number}_]", "u");
}
catch (_) { }
function hasWordChar(str) {
    if (wordChar)
        return wordChar.test(str);
    for (let i = 0; i < str.length; i++) {
        let ch = str[i];
        if (/\w/.test(ch) || ch > "\x80" && (ch.toUpperCase() != ch.toLowerCase() || nonASCIISingleCaseWordChar.test(ch)))
            return true;
    }
    return false;
}
function makeCategorizer(wordChars) {
    return (char) => {
        if (!/\S/.test(char))
            return CharCategory.Space;
        if (hasWordChar(char))
            return CharCategory.Word;
        for (let i = 0; i < wordChars.length; i++)
            if (char.indexOf(wordChars[i]) > -1)
                return CharCategory.Word;
        return CharCategory.Other;
    };
}

/**
The editor state class is a persistent (immutable) data structure.
To update a state, you [create](https://codemirror.net/6/docs/ref/#state.EditorState.update) a
[transaction](https://codemirror.net/6/docs/ref/#state.Transaction), which produces a _new_ state
instance, without modifying the original object.

As such, _never_ mutate properties of a state directly. That'll
just break things.
*/
class EditorState {
    constructor(
    /**
    @internal
    */
    config, 
    /**
    The current document.
    */
    doc, 
    /**
    The current selection.
    */
    selection, 
    /**
    @internal
    */
    values, computeSlot, tr) {
        this.config = config;
        this.doc = doc;
        this.selection = selection;
        this.values = values;
        this.status = config.statusTemplate.slice();
        this.computeSlot = computeSlot;
        // Fill in the computed state immediately, so that further queries
        // for it made during the update return this state
        if (tr)
            tr._state = this;
        for (let i = 0; i < this.config.dynamicSlots.length; i++)
            ensureAddr(this, i << 1);
        this.computeSlot = null;
    }
    field(field, require = true) {
        let addr = this.config.address[field.id];
        if (addr == null) {
            if (require)
                throw new RangeError("Field is not present in this state");
            return undefined;
        }
        ensureAddr(this, addr);
        return getAddr(this, addr);
    }
    /**
    Create a [transaction](https://codemirror.net/6/docs/ref/#state.Transaction) that updates this
    state. Any number of [transaction specs](https://codemirror.net/6/docs/ref/#state.TransactionSpec)
    can be passed. Unless
    [`sequential`](https://codemirror.net/6/docs/ref/#state.TransactionSpec.sequential) is set, the
    [changes](https://codemirror.net/6/docs/ref/#state.TransactionSpec.changes) (if any) of each spec
    are assumed to start in the _current_ document (not the document
    produced by previous specs), and its
    [selection](https://codemirror.net/6/docs/ref/#state.TransactionSpec.selection) and
    [effects](https://codemirror.net/6/docs/ref/#state.TransactionSpec.effects) are assumed to refer
    to the document created by its _own_ changes. The resulting
    transaction contains the combined effect of all the different
    specs. For [selection](https://codemirror.net/6/docs/ref/#state.TransactionSpec.selection), later
    specs take precedence over earlier ones.
    */
    update(...specs) {
        return resolveTransaction(this, specs, true);
    }
    /**
    @internal
    */
    applyTransaction(tr) {
        let conf = this.config, { base, compartments } = conf;
        for (let effect of tr.effects) {
            if (effect.is(Compartment.reconfigure)) {
                if (conf) {
                    compartments = new Map;
                    conf.compartments.forEach((val, key) => compartments.set(key, val));
                    conf = null;
                }
                compartments.set(effect.value.compartment, effect.value.extension);
            }
            else if (effect.is(StateEffect.reconfigure)) {
                conf = null;
                base = effect.value;
            }
            else if (effect.is(StateEffect.appendConfig)) {
                conf = null;
                base = asArray$1(base).concat(effect.value);
            }
        }
        let startValues;
        if (!conf) {
            conf = Configuration.resolve(base, compartments, this);
            let intermediateState = new EditorState(conf, this.doc, this.selection, conf.dynamicSlots.map(() => null), (state, slot) => slot.reconfigure(state, this), null);
            startValues = intermediateState.values;
        }
        else {
            startValues = tr.startState.values.slice();
        }
        let selection = tr.startState.facet(allowMultipleSelections) ? tr.newSelection : tr.newSelection.asSingle();
        new EditorState(conf, tr.newDoc, selection, startValues, (state, slot) => slot.update(state, tr), tr);
    }
    /**
    Create a [transaction spec](https://codemirror.net/6/docs/ref/#state.TransactionSpec) that
    replaces every selection range with the given content.
    */
    replaceSelection(text) {
        if (typeof text == "string")
            text = this.toText(text);
        return this.changeByRange(range => ({ changes: { from: range.from, to: range.to, insert: text },
            range: EditorSelection.cursor(range.from + text.length) }));
    }
    /**
    Create a set of changes and a new selection by running the given
    function for each range in the active selection. The function
    can return an optional set of changes (in the coordinate space
    of the start document), plus an updated range (in the coordinate
    space of the document produced by the call's own changes). This
    method will merge all the changes and ranges into a single
    changeset and selection, and return it as a [transaction
    spec](https://codemirror.net/6/docs/ref/#state.TransactionSpec), which can be passed to
    [`update`](https://codemirror.net/6/docs/ref/#state.EditorState.update).
    */
    changeByRange(f) {
        let sel = this.selection;
        let result1 = f(sel.ranges[0]);
        let changes = this.changes(result1.changes), ranges = [result1.range];
        let effects = asArray$1(result1.effects);
        for (let i = 1; i < sel.ranges.length; i++) {
            let result = f(sel.ranges[i]);
            let newChanges = this.changes(result.changes), newMapped = newChanges.map(changes);
            for (let j = 0; j < i; j++)
                ranges[j] = ranges[j].map(newMapped);
            let mapBy = changes.mapDesc(newChanges, true);
            ranges.push(result.range.map(mapBy));
            changes = changes.compose(newMapped);
            effects = StateEffect.mapEffects(effects, newMapped).concat(StateEffect.mapEffects(asArray$1(result.effects), mapBy));
        }
        return {
            changes,
            selection: EditorSelection.create(ranges, sel.mainIndex),
            effects
        };
    }
    /**
    Create a [change set](https://codemirror.net/6/docs/ref/#state.ChangeSet) from the given change
    description, taking the state's document length and line
    separator into account.
    */
    changes(spec = []) {
        if (spec instanceof ChangeSet)
            return spec;
        return ChangeSet.of(spec, this.doc.length, this.facet(EditorState.lineSeparator));
    }
    /**
    Using the state's [line
    separator](https://codemirror.net/6/docs/ref/#state.EditorState^lineSeparator), create a
    [`Text`](https://codemirror.net/6/docs/ref/#state.Text) instance from the given string.
    */
    toText(string) {
        return Text.of(string.split(this.facet(EditorState.lineSeparator) || DefaultSplit));
    }
    /**
    Return the given range of the document as a string.
    */
    sliceDoc(from = 0, to = this.doc.length) {
        return this.doc.sliceString(from, to, this.lineBreak);
    }
    /**
    Get the value of a state [facet](https://codemirror.net/6/docs/ref/#state.Facet).
    */
    facet(facet) {
        let addr = this.config.address[facet.id];
        if (addr == null)
            return facet.default;
        ensureAddr(this, addr);
        return getAddr(this, addr);
    }
    /**
    Convert this state to a JSON-serializable object. When custom
    fields should be serialized, you can pass them in as an object
    mapping property names (in the resulting object, which should
    not use `doc` or `selection`) to fields.
    */
    toJSON(fields) {
        let result = {
            doc: this.sliceDoc(),
            selection: this.selection.toJSON()
        };
        if (fields)
            for (let prop in fields) {
                let value = fields[prop];
                if (value instanceof StateField && this.config.address[value.id] != null)
                    result[prop] = value.spec.toJSON(this.field(fields[prop]), this);
            }
        return result;
    }
    /**
    Deserialize a state from its JSON representation. When custom
    fields should be deserialized, pass the same object you passed
    to [`toJSON`](https://codemirror.net/6/docs/ref/#state.EditorState.toJSON) when serializing as
    third argument.
    */
    static fromJSON(json, config = {}, fields) {
        if (!json || typeof json.doc != "string")
            throw new RangeError("Invalid JSON representation for EditorState");
        let fieldInit = [];
        if (fields)
            for (let prop in fields) {
                if (Object.prototype.hasOwnProperty.call(json, prop)) {
                    let field = fields[prop], value = json[prop];
                    fieldInit.push(field.init(state => field.spec.fromJSON(value, state)));
                }
            }
        return EditorState.create({
            doc: json.doc,
            selection: EditorSelection.fromJSON(json.selection),
            extensions: config.extensions ? fieldInit.concat([config.extensions]) : fieldInit
        });
    }
    /**
    Create a new state. You'll usually only need this when
    initializing an editor—updated states are created by applying
    transactions.
    */
    static create(config = {}) {
        let configuration = Configuration.resolve(config.extensions || [], new Map);
        let doc = config.doc instanceof Text ? config.doc
            : Text.of((config.doc || "").split(configuration.staticFacet(EditorState.lineSeparator) || DefaultSplit));
        let selection = !config.selection ? EditorSelection.single(0)
            : config.selection instanceof EditorSelection ? config.selection
                : EditorSelection.single(config.selection.anchor, config.selection.head);
        checkSelection(selection, doc.length);
        if (!configuration.staticFacet(allowMultipleSelections))
            selection = selection.asSingle();
        return new EditorState(configuration, doc, selection, configuration.dynamicSlots.map(() => null), (state, slot) => slot.create(state), null);
    }
    /**
    The size (in columns) of a tab in the document, determined by
    the [`tabSize`](https://codemirror.net/6/docs/ref/#state.EditorState^tabSize) facet.
    */
    get tabSize() { return this.facet(EditorState.tabSize); }
    /**
    Get the proper [line-break](https://codemirror.net/6/docs/ref/#state.EditorState^lineSeparator)
    string for this state.
    */
    get lineBreak() { return this.facet(EditorState.lineSeparator) || "\n"; }
    /**
    Returns true when the editor is
    [configured](https://codemirror.net/6/docs/ref/#state.EditorState^readOnly) to be read-only.
    */
    get readOnly() { return this.facet(readOnly); }
    /**
    Look up a translation for the given phrase (via the
    [`phrases`](https://codemirror.net/6/docs/ref/#state.EditorState^phrases) facet), or return the
    original string if no translation is found.
    
    If additional arguments are passed, they will be inserted in
    place of markers like `$1` (for the first value) and `$2`, etc.
    A single `$` is equivalent to `$1`, and `$$` will produce a
    literal dollar sign.
    */
    phrase(phrase, ...insert) {
        for (let map of this.facet(EditorState.phrases))
            if (Object.prototype.hasOwnProperty.call(map, phrase)) {
                phrase = map[phrase];
                break;
            }
        if (insert.length)
            phrase = phrase.replace(/\$(\$|\d*)/g, (m, i) => {
                if (i == "$")
                    return "$";
                let n = +(i || 1);
                return !n || n > insert.length ? m : insert[n - 1];
            });
        return phrase;
    }
    /**
    Find the values for a given language data field, provided by the
    the [`languageData`](https://codemirror.net/6/docs/ref/#state.EditorState^languageData) facet.
    
    Examples of language data fields are...
    
    - [`"commentTokens"`](https://codemirror.net/6/docs/ref/#commands.CommentTokens) for specifying
      comment syntax.
    - [`"autocomplete"`](https://codemirror.net/6/docs/ref/#autocomplete.autocompletion^config.override)
      for providing language-specific completion sources.
    - [`"wordChars"`](https://codemirror.net/6/docs/ref/#state.EditorState.charCategorizer) for adding
      characters that should be considered part of words in this
      language.
    - [`"closeBrackets"`](https://codemirror.net/6/docs/ref/#autocomplete.CloseBracketConfig) controls
      bracket closing behavior.
    */
    languageDataAt(name, pos, side = -1) {
        let values = [];
        for (let provider of this.facet(languageData)) {
            for (let result of provider(this, pos, side)) {
                if (Object.prototype.hasOwnProperty.call(result, name))
                    values.push(result[name]);
            }
        }
        return values;
    }
    /**
    Return a function that can categorize strings (expected to
    represent a single [grapheme cluster](https://codemirror.net/6/docs/ref/#state.findClusterBreak))
    into one of:
    
     - Word (contains an alphanumeric character or a character
       explicitly listed in the local language's `"wordChars"`
       language data, which should be a string)
     - Space (contains only whitespace)
     - Other (anything else)
    */
    charCategorizer(at) {
        return makeCategorizer(this.languageDataAt("wordChars", at).join(""));
    }
    /**
    Find the word at the given position, meaning the range
    containing all [word](https://codemirror.net/6/docs/ref/#state.CharCategory.Word) characters
    around it. If no word characters are adjacent to the position,
    this returns null.
    */
    wordAt(pos) {
        let { text, from, length } = this.doc.lineAt(pos);
        let cat = this.charCategorizer(pos);
        let start = pos - from, end = pos - from;
        while (start > 0) {
            let prev = findClusterBreak(text, start, false);
            if (cat(text.slice(prev, start)) != CharCategory.Word)
                break;
            start = prev;
        }
        while (end < length) {
            let next = findClusterBreak(text, end);
            if (cat(text.slice(end, next)) != CharCategory.Word)
                break;
            end = next;
        }
        return start == end ? null : EditorSelection.range(start + from, end + from);
    }
}
/**
A facet that, when enabled, causes the editor to allow multiple
ranges to be selected. Be careful though, because by default the
editor relies on the native DOM selection, which cannot handle
multiple selections. An extension like
[`drawSelection`](https://codemirror.net/6/docs/ref/#view.drawSelection) can be used to make
secondary selections visible to the user.
*/
EditorState.allowMultipleSelections = allowMultipleSelections;
/**
Configures the tab size to use in this state. The first
(highest-precedence) value of the facet is used. If no value is
given, this defaults to 4.
*/
EditorState.tabSize = /*@__PURE__*/Facet.define({
    combine: values => values.length ? values[0] : 4
});
/**
The line separator to use. By default, any of `"\n"`, `"\r\n"`
and `"\r"` is treated as a separator when splitting lines, and
lines are joined with `"\n"`.

When you configure a value here, only that precise separator
will be used, allowing you to round-trip documents through the
editor without normalizing line separators.
*/
EditorState.lineSeparator = lineSeparator;
/**
This facet controls the value of the
[`readOnly`](https://codemirror.net/6/docs/ref/#state.EditorState.readOnly) getter, which is
consulted by commands and extensions that implement editing
functionality to determine whether they should apply. It
defaults to false, but when its highest-precedence value is
`true`, such functionality disables itself.

Not to be confused with
[`EditorView.editable`](https://codemirror.net/6/docs/ref/#view.EditorView^editable), which
controls whether the editor's DOM is set to be editable (and
thus focusable).
*/
EditorState.readOnly = readOnly;
/**
Registers translation phrases. The
[`phrase`](https://codemirror.net/6/docs/ref/#state.EditorState.phrase) method will look through
all objects registered with this facet to find translations for
its argument.
*/
EditorState.phrases = /*@__PURE__*/Facet.define({
    compare(a, b) {
        let kA = Object.keys(a), kB = Object.keys(b);
        return kA.length == kB.length && kA.every(k => a[k] == b[k]);
    }
});
/**
A facet used to register [language
data](https://codemirror.net/6/docs/ref/#state.EditorState.languageDataAt) providers.
*/
EditorState.languageData = languageData;
/**
Facet used to register change filters, which are called for each
transaction (unless explicitly
[disabled](https://codemirror.net/6/docs/ref/#state.TransactionSpec.filter)), and can suppress
part of the transaction's changes.

Such a function can return `true` to indicate that it doesn't
want to do anything, `false` to completely stop the changes in
the transaction, or a set of ranges in which changes should be
suppressed. Such ranges are represented as an array of numbers,
with each pair of two numbers indicating the start and end of a
range. So for example `[10, 20, 100, 110]` suppresses changes
between 10 and 20, and between 100 and 110.
*/
EditorState.changeFilter = changeFilter;
/**
Facet used to register a hook that gets a chance to update or
replace transaction specs before they are applied. This will
only be applied for transactions that don't have
[`filter`](https://codemirror.net/6/docs/ref/#state.TransactionSpec.filter) set to `false`. You
can either return a single transaction spec (possibly the input
transaction), or an array of specs (which will be combined in
the same way as the arguments to
[`EditorState.update`](https://codemirror.net/6/docs/ref/#state.EditorState.update)).

When possible, it is recommended to avoid accessing
[`Transaction.state`](https://codemirror.net/6/docs/ref/#state.Transaction.state) in a filter,
since it will force creation of a state that will then be
discarded again, if the transaction is actually filtered.

(This functionality should be used with care. Indiscriminately
modifying transaction is likely to break something or degrade
the user experience.)
*/
EditorState.transactionFilter = transactionFilter;
/**
This is a more limited form of
[`transactionFilter`](https://codemirror.net/6/docs/ref/#state.EditorState^transactionFilter),
which can only add
[annotations](https://codemirror.net/6/docs/ref/#state.TransactionSpec.annotations) and
[effects](https://codemirror.net/6/docs/ref/#state.TransactionSpec.effects). _But_, this type
of filter runs even if the transaction has disabled regular
[filtering](https://codemirror.net/6/docs/ref/#state.TransactionSpec.filter), making it suitable
for effects that don't need to touch the changes or selection,
but do want to process every transaction.

Extenders run _after_ filters, when both are present.
*/
EditorState.transactionExtender = transactionExtender;
Compartment.reconfigure = /*@__PURE__*/StateEffect.define();

/**
Utility function for combining behaviors to fill in a config
object from an array of provided configs. `defaults` should hold
default values for all optional fields in `Config`.

The function will, by default, error
when a field gets two values that aren't `===`-equal, but you can
provide combine functions per field to do something else.
*/
function combineConfig(configs, defaults, // Should hold only the optional properties of Config, but I haven't managed to express that
combine = {}) {
    let result = {};
    for (let config of configs)
        for (let key of Object.keys(config)) {
            let value = config[key], current = result[key];
            if (current === undefined)
                result[key] = value;
            else if (current === value || value === undefined) ; // No conflict
            else if (Object.hasOwnProperty.call(combine, key))
                result[key] = combine[key](current, value);
            else
                throw new Error("Config merge conflict for field " + key);
        }
    for (let key in defaults)
        if (result[key] === undefined)
            result[key] = defaults[key];
    return result;
}

/**
Each range is associated with a value, which must inherit from
this class.
*/
class RangeValue {
    /**
    Compare this value with another value. Used when comparing
    rangesets. The default implementation compares by identity.
    Unless you are only creating a fixed number of unique instances
    of your value type, it is a good idea to implement this
    properly.
    */
    eq(other) { return this == other; }
    /**
    Create a [range](https://codemirror.net/6/docs/ref/#state.Range) with this value.
    */
    range(from, to = from) { return Range$1.create(from, to, this); }
}
RangeValue.prototype.startSide = RangeValue.prototype.endSide = 0;
RangeValue.prototype.point = false;
RangeValue.prototype.mapMode = MapMode.TrackDel;
/**
A range associates a value with a range of positions.
*/
let Range$1 = class Range {
    constructor(
    /**
    The range's start position.
    */
    from, 
    /**
    Its end position.
    */
    to, 
    /**
    The value associated with this range.
    */
    value) {
        this.from = from;
        this.to = to;
        this.value = value;
    }
    /**
    @internal
    */
    static create(from, to, value) {
        return new Range(from, to, value);
    }
};
function cmpRange(a, b) {
    return a.from - b.from || a.value.startSide - b.value.startSide;
}
class Chunk {
    constructor(from, to, value, 
    // Chunks are marked with the largest point that occurs
    // in them (or -1 for no points), so that scans that are
    // only interested in points (such as the
    // heightmap-related logic) can skip range-only chunks.
    maxPoint) {
        this.from = from;
        this.to = to;
        this.value = value;
        this.maxPoint = maxPoint;
    }
    get length() { return this.to[this.to.length - 1]; }
    // Find the index of the given position and side. Use the ranges'
    // `from` pos when `end == false`, `to` when `end == true`.
    findIndex(pos, side, end, startAt = 0) {
        let arr = end ? this.to : this.from;
        for (let lo = startAt, hi = arr.length;;) {
            if (lo == hi)
                return lo;
            let mid = (lo + hi) >> 1;
            let diff = arr[mid] - pos || (end ? this.value[mid].endSide : this.value[mid].startSide) - side;
            if (mid == lo)
                return diff >= 0 ? lo : hi;
            if (diff >= 0)
                hi = mid;
            else
                lo = mid + 1;
        }
    }
    between(offset, from, to, f) {
        for (let i = this.findIndex(from, -1000000000 /* C.Far */, true), e = this.findIndex(to, 1000000000 /* C.Far */, false, i); i < e; i++)
            if (f(this.from[i] + offset, this.to[i] + offset, this.value[i]) === false)
                return false;
    }
    map(offset, changes) {
        let value = [], from = [], to = [], newPos = -1, maxPoint = -1;
        for (let i = 0; i < this.value.length; i++) {
            let val = this.value[i], curFrom = this.from[i] + offset, curTo = this.to[i] + offset, newFrom, newTo;
            if (curFrom == curTo) {
                let mapped = changes.mapPos(curFrom, val.startSide, val.mapMode);
                if (mapped == null)
                    continue;
                newFrom = newTo = mapped;
                if (val.startSide != val.endSide) {
                    newTo = changes.mapPos(curFrom, val.endSide);
                    if (newTo < newFrom)
                        continue;
                }
            }
            else {
                newFrom = changes.mapPos(curFrom, val.startSide);
                newTo = changes.mapPos(curTo, val.endSide);
                if (newFrom > newTo || newFrom == newTo && val.startSide > 0 && val.endSide <= 0)
                    continue;
            }
            if ((newTo - newFrom || val.endSide - val.startSide) < 0)
                continue;
            if (newPos < 0)
                newPos = newFrom;
            if (val.point)
                maxPoint = Math.max(maxPoint, newTo - newFrom);
            value.push(val);
            from.push(newFrom - newPos);
            to.push(newTo - newPos);
        }
        return { mapped: value.length ? new Chunk(from, to, value, maxPoint) : null, pos: newPos };
    }
}
/**
A range set stores a collection of [ranges](https://codemirror.net/6/docs/ref/#state.Range) in a
way that makes them efficient to [map](https://codemirror.net/6/docs/ref/#state.RangeSet.map) and
[update](https://codemirror.net/6/docs/ref/#state.RangeSet.update). This is an immutable data
structure.
*/
class RangeSet {
    constructor(
    /**
    @internal
    */
    chunkPos, 
    /**
    @internal
    */
    chunk, 
    /**
    @internal
    */
    nextLayer, 
    /**
    @internal
    */
    maxPoint) {
        this.chunkPos = chunkPos;
        this.chunk = chunk;
        this.nextLayer = nextLayer;
        this.maxPoint = maxPoint;
    }
    /**
    @internal
    */
    static create(chunkPos, chunk, nextLayer, maxPoint) {
        return new RangeSet(chunkPos, chunk, nextLayer, maxPoint);
    }
    /**
    @internal
    */
    get length() {
        let last = this.chunk.length - 1;
        return last < 0 ? 0 : Math.max(this.chunkEnd(last), this.nextLayer.length);
    }
    /**
    The number of ranges in the set.
    */
    get size() {
        if (this.isEmpty)
            return 0;
        let size = this.nextLayer.size;
        for (let chunk of this.chunk)
            size += chunk.value.length;
        return size;
    }
    /**
    @internal
    */
    chunkEnd(index) {
        return this.chunkPos[index] + this.chunk[index].length;
    }
    /**
    Update the range set, optionally adding new ranges or filtering
    out existing ones.
    
    (Note: The type parameter is just there as a kludge to work
    around TypeScript variance issues that prevented `RangeSet<X>`
    from being a subtype of `RangeSet<Y>` when `X` is a subtype of
    `Y`.)
    */
    update(updateSpec) {
        let { add = [], sort = false, filterFrom = 0, filterTo = this.length } = updateSpec;
        let filter = updateSpec.filter;
        if (add.length == 0 && !filter)
            return this;
        if (sort)
            add = add.slice().sort(cmpRange);
        if (this.isEmpty)
            return add.length ? RangeSet.of(add) : this;
        let cur = new LayerCursor(this, null, -1).goto(0), i = 0, spill = [];
        let builder = new RangeSetBuilder();
        while (cur.value || i < add.length) {
            if (i < add.length && (cur.from - add[i].from || cur.startSide - add[i].value.startSide) >= 0) {
                let range = add[i++];
                if (!builder.addInner(range.from, range.to, range.value))
                    spill.push(range);
            }
            else if (cur.rangeIndex == 1 && cur.chunkIndex < this.chunk.length &&
                (i == add.length || this.chunkEnd(cur.chunkIndex) < add[i].from) &&
                (!filter || filterFrom > this.chunkEnd(cur.chunkIndex) || filterTo < this.chunkPos[cur.chunkIndex]) &&
                builder.addChunk(this.chunkPos[cur.chunkIndex], this.chunk[cur.chunkIndex])) {
                cur.nextChunk();
            }
            else {
                if (!filter || filterFrom > cur.to || filterTo < cur.from || filter(cur.from, cur.to, cur.value)) {
                    if (!builder.addInner(cur.from, cur.to, cur.value))
                        spill.push(Range$1.create(cur.from, cur.to, cur.value));
                }
                cur.next();
            }
        }
        return builder.finishInner(this.nextLayer.isEmpty && !spill.length ? RangeSet.empty
            : this.nextLayer.update({ add: spill, filter, filterFrom, filterTo }));
    }
    /**
    Map this range set through a set of changes, return the new set.
    */
    map(changes) {
        if (changes.empty || this.isEmpty)
            return this;
        let chunks = [], chunkPos = [], maxPoint = -1;
        for (let i = 0; i < this.chunk.length; i++) {
            let start = this.chunkPos[i], chunk = this.chunk[i];
            let touch = changes.touchesRange(start, start + chunk.length);
            if (touch === false) {
                maxPoint = Math.max(maxPoint, chunk.maxPoint);
                chunks.push(chunk);
                chunkPos.push(changes.mapPos(start));
            }
            else if (touch === true) {
                let { mapped, pos } = chunk.map(start, changes);
                if (mapped) {
                    maxPoint = Math.max(maxPoint, mapped.maxPoint);
                    chunks.push(mapped);
                    chunkPos.push(pos);
                }
            }
        }
        let next = this.nextLayer.map(changes);
        return chunks.length == 0 ? next : new RangeSet(chunkPos, chunks, next || RangeSet.empty, maxPoint);
    }
    /**
    Iterate over the ranges that touch the region `from` to `to`,
    calling `f` for each. There is no guarantee that the ranges will
    be reported in any specific order. When the callback returns
    `false`, iteration stops.
    */
    between(from, to, f) {
        if (this.isEmpty)
            return;
        for (let i = 0; i < this.chunk.length; i++) {
            let start = this.chunkPos[i], chunk = this.chunk[i];
            if (to >= start && from <= start + chunk.length &&
                chunk.between(start, from - start, to - start, f) === false)
                return;
        }
        this.nextLayer.between(from, to, f);
    }
    /**
    Iterate over the ranges in this set, in order, including all
    ranges that end at or after `from`.
    */
    iter(from = 0) {
        return HeapCursor.from([this]).goto(from);
    }
    /**
    @internal
    */
    get isEmpty() { return this.nextLayer == this; }
    /**
    Iterate over the ranges in a collection of sets, in order,
    starting from `from`.
    */
    static iter(sets, from = 0) {
        return HeapCursor.from(sets).goto(from);
    }
    /**
    Iterate over two groups of sets, calling methods on `comparator`
    to notify it of possible differences.
    */
    static compare(oldSets, newSets, 
    /**
    This indicates how the underlying data changed between these
    ranges, and is needed to synchronize the iteration.
    */
    textDiff, comparator, 
    /**
    Can be used to ignore all non-point ranges, and points below
    the given size. When -1, all ranges are compared.
    */
    minPointSize = -1) {
        let a = oldSets.filter(set => set.maxPoint > 0 || !set.isEmpty && set.maxPoint >= minPointSize);
        let b = newSets.filter(set => set.maxPoint > 0 || !set.isEmpty && set.maxPoint >= minPointSize);
        let sharedChunks = findSharedChunks(a, b, textDiff);
        let sideA = new SpanCursor(a, sharedChunks, minPointSize);
        let sideB = new SpanCursor(b, sharedChunks, minPointSize);
        textDiff.iterGaps((fromA, fromB, length) => compare(sideA, fromA, sideB, fromB, length, comparator));
        if (textDiff.empty && textDiff.length == 0)
            compare(sideA, 0, sideB, 0, 0, comparator);
    }
    /**
    Compare the contents of two groups of range sets, returning true
    if they are equivalent in the given range.
    */
    static eq(oldSets, newSets, from = 0, to) {
        if (to == null)
            to = 1000000000 /* C.Far */ - 1;
        let a = oldSets.filter(set => !set.isEmpty && newSets.indexOf(set) < 0);
        let b = newSets.filter(set => !set.isEmpty && oldSets.indexOf(set) < 0);
        if (a.length != b.length)
            return false;
        if (!a.length)
            return true;
        let sharedChunks = findSharedChunks(a, b);
        let sideA = new SpanCursor(a, sharedChunks, 0).goto(from), sideB = new SpanCursor(b, sharedChunks, 0).goto(from);
        for (;;) {
            if (sideA.to != sideB.to ||
                !sameValues(sideA.active, sideB.active) ||
                sideA.point && (!sideB.point || !sideA.point.eq(sideB.point)))
                return false;
            if (sideA.to > to)
                return true;
            sideA.next();
            sideB.next();
        }
    }
    /**
    Iterate over a group of range sets at the same time, notifying
    the iterator about the ranges covering every given piece of
    content. Returns the open count (see
    [`SpanIterator.span`](https://codemirror.net/6/docs/ref/#state.SpanIterator.span)) at the end
    of the iteration.
    */
    static spans(sets, from, to, iterator, 
    /**
    When given and greater than -1, only points of at least this
    size are taken into account.
    */
    minPointSize = -1) {
        let cursor = new SpanCursor(sets, null, minPointSize).goto(from), pos = from;
        let openRanges = cursor.openStart;
        for (;;) {
            let curTo = Math.min(cursor.to, to);
            if (cursor.point) {
                let active = cursor.activeForPoint(cursor.to);
                let openCount = cursor.pointFrom < from ? active.length + 1
                    : cursor.point.startSide < 0 ? active.length
                        : Math.min(active.length, openRanges);
                iterator.point(pos, curTo, cursor.point, active, openCount, cursor.pointRank);
                openRanges = Math.min(cursor.openEnd(curTo), active.length);
            }
            else if (curTo > pos) {
                iterator.span(pos, curTo, cursor.active, openRanges);
                openRanges = cursor.openEnd(curTo);
            }
            if (cursor.to > to)
                return openRanges + (cursor.point && cursor.to > to ? 1 : 0);
            pos = cursor.to;
            cursor.next();
        }
    }
    /**
    Create a range set for the given range or array of ranges. By
    default, this expects the ranges to be _sorted_ (by start
    position and, if two start at the same position,
    `value.startSide`). You can pass `true` as second argument to
    cause the method to sort them.
    */
    static of(ranges, sort = false) {
        let build = new RangeSetBuilder();
        for (let range of ranges instanceof Range$1 ? [ranges] : sort ? lazySort(ranges) : ranges)
            build.add(range.from, range.to, range.value);
        return build.finish();
    }
    /**
    Join an array of range sets into a single set.
    */
    static join(sets) {
        if (!sets.length)
            return RangeSet.empty;
        let result = sets[sets.length - 1];
        for (let i = sets.length - 2; i >= 0; i--) {
            for (let layer = sets[i]; layer != RangeSet.empty; layer = layer.nextLayer)
                result = new RangeSet(layer.chunkPos, layer.chunk, result, Math.max(layer.maxPoint, result.maxPoint));
        }
        return result;
    }
}
/**
The empty set of ranges.
*/
RangeSet.empty = /*@__PURE__*/new RangeSet([], [], null, -1);
function lazySort(ranges) {
    if (ranges.length > 1)
        for (let prev = ranges[0], i = 1; i < ranges.length; i++) {
            let cur = ranges[i];
            if (cmpRange(prev, cur) > 0)
                return ranges.slice().sort(cmpRange);
            prev = cur;
        }
    return ranges;
}
RangeSet.empty.nextLayer = RangeSet.empty;
/**
A range set builder is a data structure that helps build up a
[range set](https://codemirror.net/6/docs/ref/#state.RangeSet) directly, without first allocating
an array of [`Range`](https://codemirror.net/6/docs/ref/#state.Range) objects.
*/
class RangeSetBuilder {
    finishChunk(newArrays) {
        this.chunks.push(new Chunk(this.from, this.to, this.value, this.maxPoint));
        this.chunkPos.push(this.chunkStart);
        this.chunkStart = -1;
        this.setMaxPoint = Math.max(this.setMaxPoint, this.maxPoint);
        this.maxPoint = -1;
        if (newArrays) {
            this.from = [];
            this.to = [];
            this.value = [];
        }
    }
    /**
    Create an empty builder.
    */
    constructor() {
        this.chunks = [];
        this.chunkPos = [];
        this.chunkStart = -1;
        this.last = null;
        this.lastFrom = -1000000000 /* C.Far */;
        this.lastTo = -1000000000 /* C.Far */;
        this.from = [];
        this.to = [];
        this.value = [];
        this.maxPoint = -1;
        this.setMaxPoint = -1;
        this.nextLayer = null;
    }
    /**
    Add a range. Ranges should be added in sorted (by `from` and
    `value.startSide`) order.
    */
    add(from, to, value) {
        if (!this.addInner(from, to, value))
            (this.nextLayer || (this.nextLayer = new RangeSetBuilder)).add(from, to, value);
    }
    /**
    @internal
    */
    addInner(from, to, value) {
        let diff = from - this.lastTo || value.startSide - this.last.endSide;
        if (diff <= 0 && (from - this.lastFrom || value.startSide - this.last.startSide) < 0)
            throw new Error("Ranges must be added sorted by `from` position and `startSide`");
        if (diff < 0)
            return false;
        if (this.from.length == 250 /* C.ChunkSize */)
            this.finishChunk(true);
        if (this.chunkStart < 0)
            this.chunkStart = from;
        this.from.push(from - this.chunkStart);
        this.to.push(to - this.chunkStart);
        this.last = value;
        this.lastFrom = from;
        this.lastTo = to;
        this.value.push(value);
        if (value.point)
            this.maxPoint = Math.max(this.maxPoint, to - from);
        return true;
    }
    /**
    @internal
    */
    addChunk(from, chunk) {
        if ((from - this.lastTo || chunk.value[0].startSide - this.last.endSide) < 0)
            return false;
        if (this.from.length)
            this.finishChunk(true);
        this.setMaxPoint = Math.max(this.setMaxPoint, chunk.maxPoint);
        this.chunks.push(chunk);
        this.chunkPos.push(from);
        let last = chunk.value.length - 1;
        this.last = chunk.value[last];
        this.lastFrom = chunk.from[last] + from;
        this.lastTo = chunk.to[last] + from;
        return true;
    }
    /**
    Finish the range set. Returns the new set. The builder can't be
    used anymore after this has been called.
    */
    finish() { return this.finishInner(RangeSet.empty); }
    /**
    @internal
    */
    finishInner(next) {
        if (this.from.length)
            this.finishChunk(false);
        if (this.chunks.length == 0)
            return next;
        let result = RangeSet.create(this.chunkPos, this.chunks, this.nextLayer ? this.nextLayer.finishInner(next) : next, this.setMaxPoint);
        this.from = null; // Make sure further `add` calls produce errors
        return result;
    }
}
function findSharedChunks(a, b, textDiff) {
    let inA = new Map();
    for (let set of a)
        for (let i = 0; i < set.chunk.length; i++)
            if (set.chunk[i].maxPoint <= 0)
                inA.set(set.chunk[i], set.chunkPos[i]);
    let shared = new Set();
    for (let set of b)
        for (let i = 0; i < set.chunk.length; i++) {
            let known = inA.get(set.chunk[i]);
            if (known != null && (textDiff ? textDiff.mapPos(known) : known) == set.chunkPos[i] &&
                !(textDiff === null || textDiff === void 0 ? void 0 : textDiff.touchesRange(known, known + set.chunk[i].length)))
                shared.add(set.chunk[i]);
        }
    return shared;
}
class LayerCursor {
    constructor(layer, skip, minPoint, rank = 0) {
        this.layer = layer;
        this.skip = skip;
        this.minPoint = minPoint;
        this.rank = rank;
    }
    get startSide() { return this.value ? this.value.startSide : 0; }
    get endSide() { return this.value ? this.value.endSide : 0; }
    goto(pos, side = -1000000000 /* C.Far */) {
        this.chunkIndex = this.rangeIndex = 0;
        this.gotoInner(pos, side, false);
        return this;
    }
    gotoInner(pos, side, forward) {
        while (this.chunkIndex < this.layer.chunk.length) {
            let next = this.layer.chunk[this.chunkIndex];
            if (!(this.skip && this.skip.has(next) ||
                this.layer.chunkEnd(this.chunkIndex) < pos ||
                next.maxPoint < this.minPoint))
                break;
            this.chunkIndex++;
            forward = false;
        }
        if (this.chunkIndex < this.layer.chunk.length) {
            let rangeIndex = this.layer.chunk[this.chunkIndex].findIndex(pos - this.layer.chunkPos[this.chunkIndex], side, true);
            if (!forward || this.rangeIndex < rangeIndex)
                this.setRangeIndex(rangeIndex);
        }
        this.next();
    }
    forward(pos, side) {
        if ((this.to - pos || this.endSide - side) < 0)
            this.gotoInner(pos, side, true);
    }
    next() {
        for (;;) {
            if (this.chunkIndex == this.layer.chunk.length) {
                this.from = this.to = 1000000000 /* C.Far */;
                this.value = null;
                break;
            }
            else {
                let chunkPos = this.layer.chunkPos[this.chunkIndex], chunk = this.layer.chunk[this.chunkIndex];
                let from = chunkPos + chunk.from[this.rangeIndex];
                this.from = from;
                this.to = chunkPos + chunk.to[this.rangeIndex];
                this.value = chunk.value[this.rangeIndex];
                this.setRangeIndex(this.rangeIndex + 1);
                if (this.minPoint < 0 || this.value.point && this.to - this.from >= this.minPoint)
                    break;
            }
        }
    }
    setRangeIndex(index) {
        if (index == this.layer.chunk[this.chunkIndex].value.length) {
            this.chunkIndex++;
            if (this.skip) {
                while (this.chunkIndex < this.layer.chunk.length && this.skip.has(this.layer.chunk[this.chunkIndex]))
                    this.chunkIndex++;
            }
            this.rangeIndex = 0;
        }
        else {
            this.rangeIndex = index;
        }
    }
    nextChunk() {
        this.chunkIndex++;
        this.rangeIndex = 0;
        this.next();
    }
    compare(other) {
        return this.from - other.from || this.startSide - other.startSide || this.rank - other.rank ||
            this.to - other.to || this.endSide - other.endSide;
    }
}
class HeapCursor {
    constructor(heap) {
        this.heap = heap;
    }
    static from(sets, skip = null, minPoint = -1) {
        let heap = [];
        for (let i = 0; i < sets.length; i++) {
            for (let cur = sets[i]; !cur.isEmpty; cur = cur.nextLayer) {
                if (cur.maxPoint >= minPoint)
                    heap.push(new LayerCursor(cur, skip, minPoint, i));
            }
        }
        return heap.length == 1 ? heap[0] : new HeapCursor(heap);
    }
    get startSide() { return this.value ? this.value.startSide : 0; }
    goto(pos, side = -1000000000 /* C.Far */) {
        for (let cur of this.heap)
            cur.goto(pos, side);
        for (let i = this.heap.length >> 1; i >= 0; i--)
            heapBubble(this.heap, i);
        this.next();
        return this;
    }
    forward(pos, side) {
        for (let cur of this.heap)
            cur.forward(pos, side);
        for (let i = this.heap.length >> 1; i >= 0; i--)
            heapBubble(this.heap, i);
        if ((this.to - pos || this.value.endSide - side) < 0)
            this.next();
    }
    next() {
        if (this.heap.length == 0) {
            this.from = this.to = 1000000000 /* C.Far */;
            this.value = null;
            this.rank = -1;
        }
        else {
            let top = this.heap[0];
            this.from = top.from;
            this.to = top.to;
            this.value = top.value;
            this.rank = top.rank;
            if (top.value)
                top.next();
            heapBubble(this.heap, 0);
        }
    }
}
function heapBubble(heap, index) {
    for (let cur = heap[index];;) {
        let childIndex = (index << 1) + 1;
        if (childIndex >= heap.length)
            break;
        let child = heap[childIndex];
        if (childIndex + 1 < heap.length && child.compare(heap[childIndex + 1]) >= 0) {
            child = heap[childIndex + 1];
            childIndex++;
        }
        if (cur.compare(child) < 0)
            break;
        heap[childIndex] = cur;
        heap[index] = child;
        index = childIndex;
    }
}
class SpanCursor {
    constructor(sets, skip, minPoint) {
        this.minPoint = minPoint;
        this.active = [];
        this.activeTo = [];
        this.activeRank = [];
        this.minActive = -1;
        // A currently active point range, if any
        this.point = null;
        this.pointFrom = 0;
        this.pointRank = 0;
        this.to = -1000000000 /* C.Far */;
        this.endSide = 0;
        // The amount of open active ranges at the start of the iterator.
        // Not including points.
        this.openStart = -1;
        this.cursor = HeapCursor.from(sets, skip, minPoint);
    }
    goto(pos, side = -1000000000 /* C.Far */) {
        this.cursor.goto(pos, side);
        this.active.length = this.activeTo.length = this.activeRank.length = 0;
        this.minActive = -1;
        this.to = pos;
        this.endSide = side;
        this.openStart = -1;
        this.next();
        return this;
    }
    forward(pos, side) {
        while (this.minActive > -1 && (this.activeTo[this.minActive] - pos || this.active[this.minActive].endSide - side) < 0)
            this.removeActive(this.minActive);
        this.cursor.forward(pos, side);
    }
    removeActive(index) {
        remove(this.active, index);
        remove(this.activeTo, index);
        remove(this.activeRank, index);
        this.minActive = findMinIndex(this.active, this.activeTo);
    }
    addActive(trackOpen) {
        let i = 0, { value, to, rank } = this.cursor;
        // Organize active marks by rank first, then by size
        while (i < this.activeRank.length && (rank - this.activeRank[i] || to - this.activeTo[i]) > 0)
            i++;
        insert(this.active, i, value);
        insert(this.activeTo, i, to);
        insert(this.activeRank, i, rank);
        if (trackOpen)
            insert(trackOpen, i, this.cursor.from);
        this.minActive = findMinIndex(this.active, this.activeTo);
    }
    // After calling this, if `this.point` != null, the next range is a
    // point. Otherwise, it's a regular range, covered by `this.active`.
    next() {
        let from = this.to, wasPoint = this.point;
        this.point = null;
        let trackOpen = this.openStart < 0 ? [] : null;
        for (;;) {
            let a = this.minActive;
            if (a > -1 && (this.activeTo[a] - this.cursor.from || this.active[a].endSide - this.cursor.startSide) < 0) {
                if (this.activeTo[a] > from) {
                    this.to = this.activeTo[a];
                    this.endSide = this.active[a].endSide;
                    break;
                }
                this.removeActive(a);
                if (trackOpen)
                    remove(trackOpen, a);
            }
            else if (!this.cursor.value) {
                this.to = this.endSide = 1000000000 /* C.Far */;
                break;
            }
            else if (this.cursor.from > from) {
                this.to = this.cursor.from;
                this.endSide = this.cursor.startSide;
                break;
            }
            else {
                let nextVal = this.cursor.value;
                if (!nextVal.point) { // Opening a range
                    this.addActive(trackOpen);
                    this.cursor.next();
                }
                else if (wasPoint && this.cursor.to == this.to && this.cursor.from < this.cursor.to) {
                    // Ignore any non-empty points that end precisely at the end of the prev point
                    this.cursor.next();
                }
                else { // New point
                    this.point = nextVal;
                    this.pointFrom = this.cursor.from;
                    this.pointRank = this.cursor.rank;
                    this.to = this.cursor.to;
                    this.endSide = nextVal.endSide;
                    this.cursor.next();
                    this.forward(this.to, this.endSide);
                    break;
                }
            }
        }
        if (trackOpen) {
            this.openStart = 0;
            for (let i = trackOpen.length - 1; i >= 0 && trackOpen[i] < from; i--)
                this.openStart++;
        }
    }
    activeForPoint(to) {
        if (!this.active.length)
            return this.active;
        let active = [];
        for (let i = this.active.length - 1; i >= 0; i--) {
            if (this.activeRank[i] < this.pointRank)
                break;
            if (this.activeTo[i] > to || this.activeTo[i] == to && this.active[i].endSide >= this.point.endSide)
                active.push(this.active[i]);
        }
        return active.reverse();
    }
    openEnd(to) {
        let open = 0;
        for (let i = this.activeTo.length - 1; i >= 0 && this.activeTo[i] > to; i--)
            open++;
        return open;
    }
}
function compare(a, startA, b, startB, length, comparator) {
    a.goto(startA);
    b.goto(startB);
    let endB = startB + length;
    let pos = startB, dPos = startB - startA;
    for (;;) {
        let diff = (a.to + dPos) - b.to || a.endSide - b.endSide;
        let end = diff < 0 ? a.to + dPos : b.to, clipEnd = Math.min(end, endB);
        if (a.point || b.point) {
            if (!(a.point && b.point && (a.point == b.point || a.point.eq(b.point)) &&
                sameValues(a.activeForPoint(a.to), b.activeForPoint(b.to))))
                comparator.comparePoint(pos, clipEnd, a.point, b.point);
        }
        else {
            if (clipEnd > pos && !sameValues(a.active, b.active))
                comparator.compareRange(pos, clipEnd, a.active, b.active);
        }
        if (end > endB)
            break;
        pos = end;
        if (diff <= 0)
            a.next();
        if (diff >= 0)
            b.next();
    }
}
function sameValues(a, b) {
    if (a.length != b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (a[i] != b[i] && !a[i].eq(b[i]))
            return false;
    return true;
}
function remove(array, index) {
    for (let i = index, e = array.length - 1; i < e; i++)
        array[i] = array[i + 1];
    array.pop();
}
function insert(array, index, value) {
    for (let i = array.length - 1; i >= index; i--)
        array[i + 1] = array[i];
    array[index] = value;
}
function findMinIndex(value, array) {
    let found = -1, foundPos = 1000000000 /* C.Far */;
    for (let i = 0; i < array.length; i++)
        if ((array[i] - foundPos || value[i].endSide - value[found].endSide) < 0) {
            found = i;
            foundPos = array[i];
        }
    return found;
}

/**
Count the column position at the given offset into the string,
taking extending characters and tab size into account.
*/
function countColumn(string, tabSize, to = string.length) {
    let n = 0;
    for (let i = 0; i < to;) {
        if (string.charCodeAt(i) == 9) {
            n += tabSize - (n % tabSize);
            i++;
        }
        else {
            n++;
            i = findClusterBreak(string, i);
        }
    }
    return n;
}
/**
Find the offset that corresponds to the given column position in a
string, taking extending characters and tab size into account. By
default, the string length is returned when it is too short to
reach the column. Pass `strict` true to make it return -1 in that
situation.
*/
function findColumn(string, col, tabSize, strict) {
    for (let i = 0, n = 0;;) {
        if (n >= col)
            return i;
        if (i == string.length)
            break;
        n += string.charCodeAt(i) == 9 ? tabSize - (n % tabSize) : 1;
        i = findClusterBreak(string, i);
    }
    return strict === true ? -1 : string.length;
}

const C = "\u037c";
const COUNT = typeof Symbol == "undefined" ? "__" + C : Symbol.for(C);
const SET = typeof Symbol == "undefined" ? "__styleSet" + Math.floor(Math.random() * 1e8) : Symbol("styleSet");
const top = typeof globalThis != "undefined" ? globalThis : typeof window != "undefined" ? window : {};

// :: - Style modules encapsulate a set of CSS rules defined from
// JavaScript. Their definitions are only available in a given DOM
// root after it has been _mounted_ there with `StyleModule.mount`.
//
// Style modules should be created once and stored somewhere, as
// opposed to re-creating them every time you need them. The amount of
// CSS rules generated for a given DOM root is bounded by the amount
// of style modules that were used. So to avoid leaking rules, don't
// create these dynamically, but treat them as one-time allocations.
class StyleModule {
  // :: (Object<Style>, ?{finish: ?(string) → string})
  // Create a style module from the given spec.
  //
  // When `finish` is given, it is called on regular (non-`@`)
  // selectors (after `&` expansion) to compute the final selector.
  constructor(spec, options) {
    this.rules = [];
    let {finish} = options || {};

    function splitSelector(selector) {
      return /^@/.test(selector) ? [selector] : selector.split(/,\s*/)
    }

    function render(selectors, spec, target, isKeyframes) {
      let local = [], isAt = /^@(\w+)\b/.exec(selectors[0]), keyframes = isAt && isAt[1] == "keyframes";
      if (isAt && spec == null) return target.push(selectors[0] + ";")
      for (let prop in spec) {
        let value = spec[prop];
        if (/&/.test(prop)) {
          render(prop.split(/,\s*/).map(part => selectors.map(sel => part.replace(/&/, sel))).reduce((a, b) => a.concat(b)),
                 value, target);
        } else if (value && typeof value == "object") {
          if (!isAt) throw new RangeError("The value of a property (" + prop + ") should be a primitive value.")
          render(splitSelector(prop), value, local, keyframes);
        } else if (value != null) {
          local.push(prop.replace(/_.*/, "").replace(/[A-Z]/g, l => "-" + l.toLowerCase()) + ": " + value + ";");
        }
      }
      if (local.length || keyframes) {
        target.push((finish && !isAt && !isKeyframes ? selectors.map(finish) : selectors).join(", ") +
                    " {" + local.join(" ") + "}");
      }
    }

    for (let prop in spec) render(splitSelector(prop), spec[prop], this.rules);
  }

  // :: () → string
  // Returns a string containing the module's CSS rules.
  getRules() { return this.rules.join("\n") }

  // :: () → string
  // Generate a new unique CSS class name.
  static newName() {
    let id = top[COUNT] || 1;
    top[COUNT] = id + 1;
    return C + id.toString(36)
  }

  // :: (union<Document, ShadowRoot>, union<[StyleModule], StyleModule>, ?{nonce: ?string})
  //
  // Mount the given set of modules in the given DOM root, which ensures
  // that the CSS rules defined by the module are available in that
  // context.
  //
  // Rules are only added to the document once per root.
  //
  // Rule order will follow the order of the modules, so that rules from
  // modules later in the array take precedence of those from earlier
  // modules. If you call this function multiple times for the same root
  // in a way that changes the order of already mounted modules, the old
  // order will be changed.
  //
  // If a Content Security Policy nonce is provided, it is added to
  // the `<style>` tag generated by the library.
  static mount(root, modules, options) {
    let set = root[SET], nonce = options && options.nonce;
    if (!set) set = new StyleSet(root, nonce);
    else if (nonce) set.setNonce(nonce);
    set.mount(Array.isArray(modules) ? modules : [modules], root);
  }
}

let adoptedSet = new Map; //<Document, StyleSet>

class StyleSet {
  constructor(root, nonce) {
    let doc = root.ownerDocument || root, win = doc.defaultView;
    if (!root.head && root.adoptedStyleSheets && win.CSSStyleSheet) {
      let adopted = adoptedSet.get(doc);
      if (adopted) return root[SET] = adopted
      this.sheet = new win.CSSStyleSheet;
      adoptedSet.set(doc, this);
    } else {
      this.styleTag = doc.createElement("style");
      if (nonce) this.styleTag.setAttribute("nonce", nonce);
    }
    this.modules = [];
    root[SET] = this;
  }

  mount(modules, root) {
    let sheet = this.sheet;
    let pos = 0 /* Current rule offset */, j = 0; /* Index into this.modules */
    for (let i = 0; i < modules.length; i++) {
      let mod = modules[i], index = this.modules.indexOf(mod);
      if (index < j && index > -1) { // Ordering conflict
        this.modules.splice(index, 1);
        j--;
        index = -1;
      }
      if (index == -1) {
        this.modules.splice(j++, 0, mod);
        if (sheet) for (let k = 0; k < mod.rules.length; k++)
          sheet.insertRule(mod.rules[k], pos++);
      } else {
        while (j < index) pos += this.modules[j++].rules.length;
        pos += mod.rules.length;
        j++;
      }
    }

    if (sheet) {
      if (root.adoptedStyleSheets.indexOf(this.sheet) < 0)
        root.adoptedStyleSheets = [this.sheet, ...root.adoptedStyleSheets];
    } else {
      let text = "";
      for (let i = 0; i < this.modules.length; i++)
        text += this.modules[i].getRules() + "\n";
      this.styleTag.textContent = text;
      let target = root.head || root;
      if (this.styleTag.parentNode != target)
        target.insertBefore(this.styleTag, target.firstChild);
    }
  }

  setNonce(nonce) {
    if (this.styleTag && this.styleTag.getAttribute("nonce") != nonce)
      this.styleTag.setAttribute("nonce", nonce);
  }
}

// Style::Object<union<Style,string>>
//
// A style is an object that, in the simple case, maps CSS property
// names to strings holding their values, as in `{color: "red",
// fontWeight: "bold"}`. The property names can be given in
// camel-case—the library will insert a dash before capital letters
// when converting them to CSS.
//
// If you include an underscore in a property name, it and everything
// after it will be removed from the output, which can be useful when
// providing a property multiple times, for browser compatibility
// reasons.
//
// A property in a style object can also be a sub-selector, which
// extends the current context to add a pseudo-selector or a child
// selector. Such a property should contain a `&` character, which
// will be replaced by the current selector. For example `{"&:before":
// {content: '"hi"'}}`. Sub-selectors and regular properties can
// freely be mixed in a given object. Any property containing a `&` is
// assumed to be a sub-selector.
//
// Finally, a property can specify an @-block to be wrapped around the
// styles defined inside the object that's the property's value. For
// example to create a media query you can do `{"@media screen and
// (min-width: 400px)": {...}}`.

var base = {
  8: "Backspace",
  9: "Tab",
  10: "Enter",
  12: "NumLock",
  13: "Enter",
  16: "Shift",
  17: "Control",
  18: "Alt",
  20: "CapsLock",
  27: "Escape",
  32: " ",
  33: "PageUp",
  34: "PageDown",
  35: "End",
  36: "Home",
  37: "ArrowLeft",
  38: "ArrowUp",
  39: "ArrowRight",
  40: "ArrowDown",
  44: "PrintScreen",
  45: "Insert",
  46: "Delete",
  59: ";",
  61: "=",
  91: "Meta",
  92: "Meta",
  106: "*",
  107: "+",
  108: ",",
  109: "-",
  110: ".",
  111: "/",
  144: "NumLock",
  145: "ScrollLock",
  160: "Shift",
  161: "Shift",
  162: "Control",
  163: "Control",
  164: "Alt",
  165: "Alt",
  173: "-",
  186: ";",
  187: "=",
  188: ",",
  189: "-",
  190: ".",
  191: "/",
  192: "`",
  219: "[",
  220: "\\",
  221: "]",
  222: "'"
};

var shift = {
  48: ")",
  49: "!",
  50: "@",
  51: "#",
  52: "$",
  53: "%",
  54: "^",
  55: "&",
  56: "*",
  57: "(",
  59: ":",
  61: "+",
  173: "_",
  186: ":",
  187: "+",
  188: "<",
  189: "_",
  190: ">",
  191: "?",
  192: "~",
  219: "{",
  220: "|",
  221: "}",
  222: "\""
};

var mac = typeof navigator != "undefined" && /Mac/.test(navigator.platform);
var ie$1 = typeof navigator != "undefined" && /MSIE \d|Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(navigator.userAgent);

// Fill in the digit keys
for (var i = 0; i < 10; i++) base[48 + i] = base[96 + i] = String(i);

// The function keys
for (var i = 1; i <= 24; i++) base[i + 111] = "F" + i;

// And the alphabetic keys
for (var i = 65; i <= 90; i++) {
  base[i] = String.fromCharCode(i + 32);
  shift[i] = String.fromCharCode(i);
}

// For each code that doesn't have a shift-equivalent, copy the base name
for (var code in base) if (!shift.hasOwnProperty(code)) shift[code] = base[code];

function keyName(event) {
  // On macOS, keys held with Shift and Cmd don't reflect the effect of Shift in `.key`.
  // On IE, shift effect is never included in `.key`.
  var ignoreKey = mac && event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey ||
      ie$1 && event.shiftKey && event.key && event.key.length == 1 ||
      event.key == "Unidentified";
  var name = (!ignoreKey && event.key) ||
    (event.shiftKey ? shift : base)[event.keyCode] ||
    event.key || "Unidentified";
  // Edge sometimes produces wrong names (Issue #3)
  if (name == "Esc") name = "Escape";
  if (name == "Del") name = "Delete";
  // https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/8860571/
  if (name == "Left") name = "ArrowLeft";
  if (name == "Up") name = "ArrowUp";
  if (name == "Right") name = "ArrowRight";
  if (name == "Down") name = "ArrowDown";
  return name
}

function getSelection(root) {
    let target;
    // Browsers differ on whether shadow roots have a getSelection
    // method. If it exists, use that, otherwise, call it on the
    // document.
    if (root.nodeType == 11) { // Shadow root
        target = root.getSelection ? root : root.ownerDocument;
    }
    else {
        target = root;
    }
    return target.getSelection();
}
function contains(dom, node) {
    return node ? dom == node || dom.contains(node.nodeType != 1 ? node.parentNode : node) : false;
}
function deepActiveElement(doc) {
    let elt = doc.activeElement;
    while (elt && elt.shadowRoot)
        elt = elt.shadowRoot.activeElement;
    return elt;
}
function hasSelection(dom, selection) {
    if (!selection.anchorNode)
        return false;
    try {
        // Firefox will raise 'permission denied' errors when accessing
        // properties of `sel.anchorNode` when it's in a generated CSS
        // element.
        return contains(dom, selection.anchorNode);
    }
    catch (_) {
        return false;
    }
}
function clientRectsFor(dom) {
    if (dom.nodeType == 3)
        return textRange(dom, 0, dom.nodeValue.length).getClientRects();
    else if (dom.nodeType == 1)
        return dom.getClientRects();
    else
        return [];
}
// Scans forward and backward through DOM positions equivalent to the
// given one to see if the two are in the same place (i.e. after a
// text node vs at the end of that text node)
function isEquivalentPosition(node, off, targetNode, targetOff) {
    return targetNode ? (scanFor(node, off, targetNode, targetOff, -1) ||
        scanFor(node, off, targetNode, targetOff, 1)) : false;
}
function domIndex(node) {
    for (var index = 0;; index++) {
        node = node.previousSibling;
        if (!node)
            return index;
    }
}
function isBlockElement(node) {
    return node.nodeType == 1 && /^(DIV|P|LI|UL|OL|BLOCKQUOTE|DD|DT|H\d|SECTION|PRE)$/.test(node.nodeName);
}
function scanFor(node, off, targetNode, targetOff, dir) {
    for (;;) {
        if (node == targetNode && off == targetOff)
            return true;
        if (off == (dir < 0 ? 0 : maxOffset(node))) {
            if (node.nodeName == "DIV")
                return false;
            let parent = node.parentNode;
            if (!parent || parent.nodeType != 1)
                return false;
            off = domIndex(node) + (dir < 0 ? 0 : 1);
            node = parent;
        }
        else if (node.nodeType == 1) {
            node = node.childNodes[off + (dir < 0 ? -1 : 0)];
            if (node.nodeType == 1 && node.contentEditable == "false")
                return false;
            off = dir < 0 ? maxOffset(node) : 0;
        }
        else {
            return false;
        }
    }
}
function maxOffset(node) {
    return node.nodeType == 3 ? node.nodeValue.length : node.childNodes.length;
}
function flattenRect(rect, left) {
    let x = left ? rect.left : rect.right;
    return { left: x, right: x, top: rect.top, bottom: rect.bottom };
}
function windowRect(win) {
    let vp = win.visualViewport;
    if (vp)
        return {
            left: 0, right: vp.width,
            top: 0, bottom: vp.height
        };
    return { left: 0, right: win.innerWidth,
        top: 0, bottom: win.innerHeight };
}
function getScale(elt, rect) {
    let scaleX = rect.width / elt.offsetWidth;
    let scaleY = rect.height / elt.offsetHeight;
    if (scaleX > 0.995 && scaleX < 1.005 || !isFinite(scaleX) || Math.abs(rect.width - elt.offsetWidth) < 1)
        scaleX = 1;
    if (scaleY > 0.995 && scaleY < 1.005 || !isFinite(scaleY) || Math.abs(rect.height - elt.offsetHeight) < 1)
        scaleY = 1;
    return { scaleX, scaleY };
}
function scrollRectIntoView(dom, rect, side, x, y, xMargin, yMargin, ltr) {
    let doc = dom.ownerDocument, win = doc.defaultView || window;
    for (let cur = dom, stop = false; cur && !stop;) {
        if (cur.nodeType == 1) { // Element
            let bounding, top = cur == doc.body;
            let scaleX = 1, scaleY = 1;
            if (top) {
                bounding = windowRect(win);
            }
            else {
                if (/^(fixed|sticky)$/.test(getComputedStyle(cur).position))
                    stop = true;
                if (cur.scrollHeight <= cur.clientHeight && cur.scrollWidth <= cur.clientWidth) {
                    cur = cur.assignedSlot || cur.parentNode;
                    continue;
                }
                let rect = cur.getBoundingClientRect();
                ({ scaleX, scaleY } = getScale(cur, rect));
                // Make sure scrollbar width isn't included in the rectangle
                bounding = { left: rect.left, right: rect.left + cur.clientWidth * scaleX,
                    top: rect.top, bottom: rect.top + cur.clientHeight * scaleY };
            }
            let moveX = 0, moveY = 0;
            if (y == "nearest") {
                if (rect.top < bounding.top) {
                    moveY = -(bounding.top - rect.top + yMargin);
                    if (side > 0 && rect.bottom > bounding.bottom + moveY)
                        moveY = rect.bottom - bounding.bottom + moveY + yMargin;
                }
                else if (rect.bottom > bounding.bottom) {
                    moveY = rect.bottom - bounding.bottom + yMargin;
                    if (side < 0 && (rect.top - moveY) < bounding.top)
                        moveY = -(bounding.top + moveY - rect.top + yMargin);
                }
            }
            else {
                let rectHeight = rect.bottom - rect.top, boundingHeight = bounding.bottom - bounding.top;
                let targetTop = y == "center" && rectHeight <= boundingHeight ? rect.top + rectHeight / 2 - boundingHeight / 2 :
                    y == "start" || y == "center" && side < 0 ? rect.top - yMargin :
                        rect.bottom - boundingHeight + yMargin;
                moveY = targetTop - bounding.top;
            }
            if (x == "nearest") {
                if (rect.left < bounding.left) {
                    moveX = -(bounding.left - rect.left + xMargin);
                    if (side > 0 && rect.right > bounding.right + moveX)
                        moveX = rect.right - bounding.right + moveX + xMargin;
                }
                else if (rect.right > bounding.right) {
                    moveX = rect.right - bounding.right + xMargin;
                    if (side < 0 && rect.left < bounding.left + moveX)
                        moveX = -(bounding.left + moveX - rect.left + xMargin);
                }
            }
            else {
                let targetLeft = x == "center" ? rect.left + (rect.right - rect.left) / 2 - (bounding.right - bounding.left) / 2 :
                    (x == "start") == ltr ? rect.left - xMargin :
                        rect.right - (bounding.right - bounding.left) + xMargin;
                moveX = targetLeft - bounding.left;
            }
            if (moveX || moveY) {
                if (top) {
                    win.scrollBy(moveX, moveY);
                }
                else {
                    let movedX = 0, movedY = 0;
                    if (moveY) {
                        let start = cur.scrollTop;
                        cur.scrollTop += moveY / scaleY;
                        movedY = (cur.scrollTop - start) * scaleY;
                    }
                    if (moveX) {
                        let start = cur.scrollLeft;
                        cur.scrollLeft += moveX / scaleX;
                        movedX = (cur.scrollLeft - start) * scaleX;
                    }
                    rect = { left: rect.left - movedX, top: rect.top - movedY,
                        right: rect.right - movedX, bottom: rect.bottom - movedY };
                    if (movedX && Math.abs(movedX - moveX) < 1)
                        x = "nearest";
                    if (movedY && Math.abs(movedY - moveY) < 1)
                        y = "nearest";
                }
            }
            if (top)
                break;
            cur = cur.assignedSlot || cur.parentNode;
        }
        else if (cur.nodeType == 11) { // A shadow root
            cur = cur.host;
        }
        else {
            break;
        }
    }
}
function scrollableParents(dom) {
    let doc = dom.ownerDocument, x, y;
    for (let cur = dom.parentNode; cur;) {
        if (cur == doc.body || (x && y)) {
            break;
        }
        else if (cur.nodeType == 1) {
            if (!y && cur.scrollHeight > cur.clientHeight)
                y = cur;
            if (!x && cur.scrollWidth > cur.clientWidth)
                x = cur;
            cur = cur.assignedSlot || cur.parentNode;
        }
        else if (cur.nodeType == 11) {
            cur = cur.host;
        }
        else {
            break;
        }
    }
    return { x, y };
}
class DOMSelectionState {
    constructor() {
        this.anchorNode = null;
        this.anchorOffset = 0;
        this.focusNode = null;
        this.focusOffset = 0;
    }
    eq(domSel) {
        return this.anchorNode == domSel.anchorNode && this.anchorOffset == domSel.anchorOffset &&
            this.focusNode == domSel.focusNode && this.focusOffset == domSel.focusOffset;
    }
    setRange(range) {
        let { anchorNode, focusNode } = range;
        // Clip offsets to node size to avoid crashes when Safari reports bogus offsets (#1152)
        this.set(anchorNode, Math.min(range.anchorOffset, anchorNode ? maxOffset(anchorNode) : 0), focusNode, Math.min(range.focusOffset, focusNode ? maxOffset(focusNode) : 0));
    }
    set(anchorNode, anchorOffset, focusNode, focusOffset) {
        this.anchorNode = anchorNode;
        this.anchorOffset = anchorOffset;
        this.focusNode = focusNode;
        this.focusOffset = focusOffset;
    }
}
let preventScrollSupported = null;
// Feature-detects support for .focus({preventScroll: true}), and uses
// a fallback kludge when not supported.
function focusPreventScroll(dom) {
    if (dom.setActive)
        return dom.setActive(); // in IE
    if (preventScrollSupported)
        return dom.focus(preventScrollSupported);
    let stack = [];
    for (let cur = dom; cur; cur = cur.parentNode) {
        stack.push(cur, cur.scrollTop, cur.scrollLeft);
        if (cur == cur.ownerDocument)
            break;
    }
    dom.focus(preventScrollSupported == null ? {
        get preventScroll() {
            preventScrollSupported = { preventScroll: true };
            return true;
        }
    } : undefined);
    if (!preventScrollSupported) {
        preventScrollSupported = false;
        for (let i = 0; i < stack.length;) {
            let elt = stack[i++], top = stack[i++], left = stack[i++];
            if (elt.scrollTop != top)
                elt.scrollTop = top;
            if (elt.scrollLeft != left)
                elt.scrollLeft = left;
        }
    }
}
let scratchRange;
function textRange(node, from, to = from) {
    let range = scratchRange || (scratchRange = document.createRange());
    range.setEnd(node, to);
    range.setStart(node, from);
    return range;
}
function dispatchKey(elt, name, code, mods) {
    let options = { key: name, code: name, keyCode: code, which: code, cancelable: true };
    if (mods)
        ({ altKey: options.altKey, ctrlKey: options.ctrlKey, shiftKey: options.shiftKey, metaKey: options.metaKey } = mods);
    let down = new KeyboardEvent("keydown", options);
    down.synthetic = true;
    elt.dispatchEvent(down);
    let up = new KeyboardEvent("keyup", options);
    up.synthetic = true;
    elt.dispatchEvent(up);
    return down.defaultPrevented || up.defaultPrevented;
}
function getRoot(node) {
    while (node) {
        if (node && (node.nodeType == 9 || node.nodeType == 11 && node.host))
            return node;
        node = node.assignedSlot || node.parentNode;
    }
    return null;
}
function clearAttributes(node) {
    while (node.attributes.length)
        node.removeAttributeNode(node.attributes[0]);
}
function atElementStart(doc, selection) {
    let node = selection.focusNode, offset = selection.focusOffset;
    if (!node || selection.anchorNode != node || selection.anchorOffset != offset)
        return false;
    // Safari can report bogus offsets (#1152)
    offset = Math.min(offset, maxOffset(node));
    for (;;) {
        if (offset) {
            if (node.nodeType != 1)
                return false;
            let prev = node.childNodes[offset - 1];
            if (prev.contentEditable == "false")
                offset--;
            else {
                node = prev;
                offset = maxOffset(node);
            }
        }
        else if (node == doc) {
            return true;
        }
        else {
            offset = domIndex(node);
            node = node.parentNode;
        }
    }
}
function isScrolledToBottom(elt) {
    return elt.scrollTop > Math.max(1, elt.scrollHeight - elt.clientHeight - 4);
}
function textNodeBefore(startNode, startOffset) {
    for (let node = startNode, offset = startOffset;;) {
        if (node.nodeType == 3 && offset > 0) {
            return { node: node, offset: offset };
        }
        else if (node.nodeType == 1 && offset > 0) {
            if (node.contentEditable == "false")
                return null;
            node = node.childNodes[offset - 1];
            offset = maxOffset(node);
        }
        else if (node.parentNode && !isBlockElement(node)) {
            offset = domIndex(node);
            node = node.parentNode;
        }
        else {
            return null;
        }
    }
}
function textNodeAfter(startNode, startOffset) {
    for (let node = startNode, offset = startOffset;;) {
        if (node.nodeType == 3 && offset < node.nodeValue.length) {
            return { node: node, offset: offset };
        }
        else if (node.nodeType == 1 && offset < node.childNodes.length) {
            if (node.contentEditable == "false")
                return null;
            node = node.childNodes[offset];
            offset = 0;
        }
        else if (node.parentNode && !isBlockElement(node)) {
            offset = domIndex(node) + 1;
            node = node.parentNode;
        }
        else {
            return null;
        }
    }
}

class DOMPos {
    constructor(node, offset, precise = true) {
        this.node = node;
        this.offset = offset;
        this.precise = precise;
    }
    static before(dom, precise) { return new DOMPos(dom.parentNode, domIndex(dom), precise); }
    static after(dom, precise) { return new DOMPos(dom.parentNode, domIndex(dom) + 1, precise); }
}
const noChildren = [];
class ContentView {
    constructor() {
        this.parent = null;
        this.dom = null;
        this.flags = 2 /* ViewFlag.NodeDirty */;
    }
    get overrideDOMText() { return null; }
    get posAtStart() {
        return this.parent ? this.parent.posBefore(this) : 0;
    }
    get posAtEnd() {
        return this.posAtStart + this.length;
    }
    posBefore(view) {
        let pos = this.posAtStart;
        for (let child of this.children) {
            if (child == view)
                return pos;
            pos += child.length + child.breakAfter;
        }
        throw new RangeError("Invalid child in posBefore");
    }
    posAfter(view) {
        return this.posBefore(view) + view.length;
    }
    sync(view, track) {
        if (this.flags & 2 /* ViewFlag.NodeDirty */) {
            let parent = this.dom;
            let prev = null, next;
            for (let child of this.children) {
                if (child.flags & 7 /* ViewFlag.Dirty */) {
                    if (!child.dom && (next = prev ? prev.nextSibling : parent.firstChild)) {
                        let contentView = ContentView.get(next);
                        if (!contentView || !contentView.parent && contentView.canReuseDOM(child))
                            child.reuseDOM(next);
                    }
                    child.sync(view, track);
                    child.flags &= ~7 /* ViewFlag.Dirty */;
                }
                next = prev ? prev.nextSibling : parent.firstChild;
                if (track && !track.written && track.node == parent && next != child.dom)
                    track.written = true;
                if (child.dom.parentNode == parent) {
                    while (next && next != child.dom)
                        next = rm$1(next);
                }
                else {
                    parent.insertBefore(child.dom, next);
                }
                prev = child.dom;
            }
            next = prev ? prev.nextSibling : parent.firstChild;
            if (next && track && track.node == parent)
                track.written = true;
            while (next)
                next = rm$1(next);
        }
        else if (this.flags & 1 /* ViewFlag.ChildDirty */) {
            for (let child of this.children)
                if (child.flags & 7 /* ViewFlag.Dirty */) {
                    child.sync(view, track);
                    child.flags &= ~7 /* ViewFlag.Dirty */;
                }
        }
    }
    reuseDOM(_dom) { }
    localPosFromDOM(node, offset) {
        let after;
        if (node == this.dom) {
            after = this.dom.childNodes[offset];
        }
        else {
            let bias = maxOffset(node) == 0 ? 0 : offset == 0 ? -1 : 1;
            for (;;) {
                let parent = node.parentNode;
                if (parent == this.dom)
                    break;
                if (bias == 0 && parent.firstChild != parent.lastChild) {
                    if (node == parent.firstChild)
                        bias = -1;
                    else
                        bias = 1;
                }
                node = parent;
            }
            if (bias < 0)
                after = node;
            else
                after = node.nextSibling;
        }
        if (after == this.dom.firstChild)
            return 0;
        while (after && !ContentView.get(after))
            after = after.nextSibling;
        if (!after)
            return this.length;
        for (let i = 0, pos = 0;; i++) {
            let child = this.children[i];
            if (child.dom == after)
                return pos;
            pos += child.length + child.breakAfter;
        }
    }
    domBoundsAround(from, to, offset = 0) {
        let fromI = -1, fromStart = -1, toI = -1, toEnd = -1;
        for (let i = 0, pos = offset, prevEnd = offset; i < this.children.length; i++) {
            let child = this.children[i], end = pos + child.length;
            if (pos < from && end > to)
                return child.domBoundsAround(from, to, pos);
            if (end >= from && fromI == -1) {
                fromI = i;
                fromStart = pos;
            }
            if (pos > to && child.dom.parentNode == this.dom) {
                toI = i;
                toEnd = prevEnd;
                break;
            }
            prevEnd = end;
            pos = end + child.breakAfter;
        }
        return { from: fromStart, to: toEnd < 0 ? offset + this.length : toEnd,
            startDOM: (fromI ? this.children[fromI - 1].dom.nextSibling : null) || this.dom.firstChild,
            endDOM: toI < this.children.length && toI >= 0 ? this.children[toI].dom : null };
    }
    markDirty(andParent = false) {
        this.flags |= 2 /* ViewFlag.NodeDirty */;
        this.markParentsDirty(andParent);
    }
    markParentsDirty(childList) {
        for (let parent = this.parent; parent; parent = parent.parent) {
            if (childList)
                parent.flags |= 2 /* ViewFlag.NodeDirty */;
            if (parent.flags & 1 /* ViewFlag.ChildDirty */)
                return;
            parent.flags |= 1 /* ViewFlag.ChildDirty */;
            childList = false;
        }
    }
    setParent(parent) {
        if (this.parent != parent) {
            this.parent = parent;
            if (this.flags & 7 /* ViewFlag.Dirty */)
                this.markParentsDirty(true);
        }
    }
    setDOM(dom) {
        if (this.dom == dom)
            return;
        if (this.dom)
            this.dom.cmView = null;
        this.dom = dom;
        dom.cmView = this;
    }
    get rootView() {
        for (let v = this;;) {
            let parent = v.parent;
            if (!parent)
                return v;
            v = parent;
        }
    }
    replaceChildren(from, to, children = noChildren) {
        this.markDirty();
        for (let i = from; i < to; i++) {
            let child = this.children[i];
            if (child.parent == this && children.indexOf(child) < 0)
                child.destroy();
        }
        this.children.splice(from, to - from, ...children);
        for (let i = 0; i < children.length; i++)
            children[i].setParent(this);
    }
    ignoreMutation(_rec) { return false; }
    ignoreEvent(_event) { return false; }
    childCursor(pos = this.length) {
        return new ChildCursor(this.children, pos, this.children.length);
    }
    childPos(pos, bias = 1) {
        return this.childCursor().findPos(pos, bias);
    }
    toString() {
        let name = this.constructor.name.replace("View", "");
        return name + (this.children.length ? "(" + this.children.join() + ")" :
            this.length ? "[" + (name == "Text" ? this.text : this.length) + "]" : "") +
            (this.breakAfter ? "#" : "");
    }
    static get(node) { return node.cmView; }
    get isEditable() { return true; }
    get isWidget() { return false; }
    get isHidden() { return false; }
    merge(from, to, source, hasStart, openStart, openEnd) {
        return false;
    }
    become(other) { return false; }
    canReuseDOM(other) {
        return other.constructor == this.constructor && !((this.flags | other.flags) & 8 /* ViewFlag.Composition */);
    }
    // When this is a zero-length view with a side, this should return a
    // number <= 0 to indicate it is before its position, or a
    // number > 0 when after its position.
    getSide() { return 0; }
    destroy() {
        for (let child of this.children)
            if (child.parent == this)
                child.destroy();
        this.parent = null;
    }
}
ContentView.prototype.breakAfter = 0;
// Remove a DOM node and return its next sibling.
function rm$1(dom) {
    let next = dom.nextSibling;
    dom.parentNode.removeChild(dom);
    return next;
}
class ChildCursor {
    constructor(children, pos, i) {
        this.children = children;
        this.pos = pos;
        this.i = i;
        this.off = 0;
    }
    findPos(pos, bias = 1) {
        for (;;) {
            if (pos > this.pos || pos == this.pos &&
                (bias > 0 || this.i == 0 || this.children[this.i - 1].breakAfter)) {
                this.off = pos - this.pos;
                return this;
            }
            let next = this.children[--this.i];
            this.pos -= next.length + next.breakAfter;
        }
    }
}
function replaceRange(parent, fromI, fromOff, toI, toOff, insert, breakAtStart, openStart, openEnd) {
    let { children } = parent;
    let before = children.length ? children[fromI] : null;
    let last = insert.length ? insert[insert.length - 1] : null;
    let breakAtEnd = last ? last.breakAfter : breakAtStart;
    // Change within a single child
    if (fromI == toI && before && !breakAtStart && !breakAtEnd && insert.length < 2 &&
        before.merge(fromOff, toOff, insert.length ? last : null, fromOff == 0, openStart, openEnd))
        return;
    if (toI < children.length) {
        let after = children[toI];
        // Make sure the end of the child after the update is preserved in `after`
        if (after && (toOff < after.length || after.breakAfter && (last === null || last === void 0 ? void 0 : last.breakAfter))) {
            // If we're splitting a child, separate part of it to avoid that
            // being mangled when updating the child before the update.
            if (fromI == toI) {
                after = after.split(toOff);
                toOff = 0;
            }
            // If the element after the replacement should be merged with
            // the last replacing element, update `content`
            if (!breakAtEnd && last && after.merge(0, toOff, last, true, 0, openEnd)) {
                insert[insert.length - 1] = after;
            }
            else {
                // Remove the start of the after element, if necessary, and
                // add it to `content`.
                if (toOff || after.children.length && !after.children[0].length)
                    after.merge(0, toOff, null, false, 0, openEnd);
                insert.push(after);
            }
        }
        else if (after === null || after === void 0 ? void 0 : after.breakAfter) {
            // The element at `toI` is entirely covered by this range.
            // Preserve its line break, if any.
            if (last)
                last.breakAfter = 1;
            else
                breakAtStart = 1;
        }
        // Since we've handled the next element from the current elements
        // now, make sure `toI` points after that.
        toI++;
    }
    if (before) {
        before.breakAfter = breakAtStart;
        if (fromOff > 0) {
            if (!breakAtStart && insert.length && before.merge(fromOff, before.length, insert[0], false, openStart, 0)) {
                before.breakAfter = insert.shift().breakAfter;
            }
            else if (fromOff < before.length || before.children.length && before.children[before.children.length - 1].length == 0) {
                before.merge(fromOff, before.length, null, false, openStart, 0);
            }
            fromI++;
        }
    }
    // Try to merge widgets on the boundaries of the replacement
    while (fromI < toI && insert.length) {
        if (children[toI - 1].become(insert[insert.length - 1])) {
            toI--;
            insert.pop();
            openEnd = insert.length ? 0 : openStart;
        }
        else if (children[fromI].become(insert[0])) {
            fromI++;
            insert.shift();
            openStart = insert.length ? 0 : openEnd;
        }
        else {
            break;
        }
    }
    if (!insert.length && fromI && toI < children.length && !children[fromI - 1].breakAfter &&
        children[toI].merge(0, 0, children[fromI - 1], false, openStart, openEnd))
        fromI--;
    if (fromI < toI || insert.length)
        parent.replaceChildren(fromI, toI, insert);
}
function mergeChildrenInto(parent, from, to, insert, openStart, openEnd) {
    let cur = parent.childCursor();
    let { i: toI, off: toOff } = cur.findPos(to, 1);
    let { i: fromI, off: fromOff } = cur.findPos(from, -1);
    let dLen = from - to;
    for (let view of insert)
        dLen += view.length;
    parent.length += dLen;
    replaceRange(parent, fromI, fromOff, toI, toOff, insert, 0, openStart, openEnd);
}

let nav = typeof navigator != "undefined" ? navigator : { userAgent: "", vendor: "", platform: "" };
let doc = typeof document != "undefined" ? document : { documentElement: { style: {} } };
const ie_edge = /*@__PURE__*//Edge\/(\d+)/.exec(nav.userAgent);
const ie_upto10 = /*@__PURE__*//MSIE \d/.test(nav.userAgent);
const ie_11up = /*@__PURE__*//Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(nav.userAgent);
const ie = !!(ie_upto10 || ie_11up || ie_edge);
const gecko = !ie && /*@__PURE__*//gecko\/(\d+)/i.test(nav.userAgent);
const chrome = !ie && /*@__PURE__*//Chrome\/(\d+)/.exec(nav.userAgent);
const webkit = "webkitFontSmoothing" in doc.documentElement.style;
const safari = !ie && /*@__PURE__*//Apple Computer/.test(nav.vendor);
const ios = safari && (/*@__PURE__*//Mobile\/\w+/.test(nav.userAgent) || nav.maxTouchPoints > 2);
var browser = {
    mac: ios || /*@__PURE__*//Mac/.test(nav.platform),
    windows: /*@__PURE__*//Win/.test(nav.platform),
    linux: /*@__PURE__*//Linux|X11/.test(nav.platform),
    ie,
    ie_version: ie_upto10 ? doc.documentMode || 6 : ie_11up ? +ie_11up[1] : ie_edge ? +ie_edge[1] : 0,
    gecko,
    gecko_version: gecko ? +(/*@__PURE__*//Firefox\/(\d+)/.exec(nav.userAgent) || [0, 0])[1] : 0,
    chrome: !!chrome,
    chrome_version: chrome ? +chrome[1] : 0,
    ios,
    android: /*@__PURE__*//Android\b/.test(nav.userAgent),
    webkit,
    safari,
    webkit_version: webkit ? +(/*@__PURE__*//\bAppleWebKit\/(\d+)/.exec(nav.userAgent) || [0, 0])[1] : 0,
    tabSize: doc.documentElement.style.tabSize != null ? "tab-size" : "-moz-tab-size"
};

const MaxJoinLen = 256;
class TextView extends ContentView {
    constructor(text) {
        super();
        this.text = text;
    }
    get length() { return this.text.length; }
    createDOM(textDOM) {
        this.setDOM(textDOM || document.createTextNode(this.text));
    }
    sync(view, track) {
        if (!this.dom)
            this.createDOM();
        if (this.dom.nodeValue != this.text) {
            if (track && track.node == this.dom)
                track.written = true;
            this.dom.nodeValue = this.text;
        }
    }
    reuseDOM(dom) {
        if (dom.nodeType == 3)
            this.createDOM(dom);
    }
    merge(from, to, source) {
        if ((this.flags & 8 /* ViewFlag.Composition */) ||
            source && (!(source instanceof TextView) ||
                this.length - (to - from) + source.length > MaxJoinLen ||
                (source.flags & 8 /* ViewFlag.Composition */)))
            return false;
        this.text = this.text.slice(0, from) + (source ? source.text : "") + this.text.slice(to);
        this.markDirty();
        return true;
    }
    split(from) {
        let result = new TextView(this.text.slice(from));
        this.text = this.text.slice(0, from);
        this.markDirty();
        result.flags |= this.flags & 8 /* ViewFlag.Composition */;
        return result;
    }
    localPosFromDOM(node, offset) {
        return node == this.dom ? offset : offset ? this.text.length : 0;
    }
    domAtPos(pos) { return new DOMPos(this.dom, pos); }
    domBoundsAround(_from, _to, offset) {
        return { from: offset, to: offset + this.length, startDOM: this.dom, endDOM: this.dom.nextSibling };
    }
    coordsAt(pos, side) {
        return textCoords(this.dom, pos, side);
    }
}
class MarkView extends ContentView {
    constructor(mark, children = [], length = 0) {
        super();
        this.mark = mark;
        this.children = children;
        this.length = length;
        for (let ch of children)
            ch.setParent(this);
    }
    setAttrs(dom) {
        clearAttributes(dom);
        if (this.mark.class)
            dom.className = this.mark.class;
        if (this.mark.attrs)
            for (let name in this.mark.attrs)
                dom.setAttribute(name, this.mark.attrs[name]);
        return dom;
    }
    canReuseDOM(other) {
        return super.canReuseDOM(other) && !((this.flags | other.flags) & 8 /* ViewFlag.Composition */);
    }
    reuseDOM(node) {
        if (node.nodeName == this.mark.tagName.toUpperCase()) {
            this.setDOM(node);
            this.flags |= 4 /* ViewFlag.AttrsDirty */ | 2 /* ViewFlag.NodeDirty */;
        }
    }
    sync(view, track) {
        if (!this.dom)
            this.setDOM(this.setAttrs(document.createElement(this.mark.tagName)));
        else if (this.flags & 4 /* ViewFlag.AttrsDirty */)
            this.setAttrs(this.dom);
        super.sync(view, track);
    }
    merge(from, to, source, _hasStart, openStart, openEnd) {
        if (source && (!(source instanceof MarkView && source.mark.eq(this.mark)) ||
            (from && openStart <= 0) || (to < this.length && openEnd <= 0)))
            return false;
        mergeChildrenInto(this, from, to, source ? source.children.slice() : [], openStart - 1, openEnd - 1);
        this.markDirty();
        return true;
    }
    split(from) {
        let result = [], off = 0, detachFrom = -1, i = 0;
        for (let elt of this.children) {
            let end = off + elt.length;
            if (end > from)
                result.push(off < from ? elt.split(from - off) : elt);
            if (detachFrom < 0 && off >= from)
                detachFrom = i;
            off = end;
            i++;
        }
        let length = this.length - from;
        this.length = from;
        if (detachFrom > -1) {
            this.children.length = detachFrom;
            this.markDirty();
        }
        return new MarkView(this.mark, result, length);
    }
    domAtPos(pos) {
        return inlineDOMAtPos(this, pos);
    }
    coordsAt(pos, side) {
        return coordsInChildren(this, pos, side);
    }
}
function textCoords(text, pos, side) {
    let length = text.nodeValue.length;
    if (pos > length)
        pos = length;
    let from = pos, to = pos, flatten = 0;
    if (pos == 0 && side < 0 || pos == length && side >= 0) {
        if (!(browser.chrome || browser.gecko)) { // These browsers reliably return valid rectangles for empty ranges
            if (pos) {
                from--;
                flatten = 1;
            } // FIXME this is wrong in RTL text
            else if (to < length) {
                to++;
                flatten = -1;
            }
        }
    }
    else {
        if (side < 0)
            from--;
        else if (to < length)
            to++;
    }
    let rects = textRange(text, from, to).getClientRects();
    if (!rects.length)
        return null;
    let rect = rects[(flatten ? flatten < 0 : side >= 0) ? 0 : rects.length - 1];
    if (browser.safari && !flatten && rect.width == 0)
        rect = Array.prototype.find.call(rects, r => r.width) || rect;
    return flatten ? flattenRect(rect, flatten < 0) : rect || null;
}
// Also used for collapsed ranges that don't have a placeholder widget!
class WidgetView extends ContentView {
    static create(widget, length, side) {
        return new WidgetView(widget, length, side);
    }
    constructor(widget, length, side) {
        super();
        this.widget = widget;
        this.length = length;
        this.side = side;
        this.prevWidget = null;
    }
    split(from) {
        let result = WidgetView.create(this.widget, this.length - from, this.side);
        this.length -= from;
        return result;
    }
    sync(view) {
        if (!this.dom || !this.widget.updateDOM(this.dom, view)) {
            if (this.dom && this.prevWidget)
                this.prevWidget.destroy(this.dom);
            this.prevWidget = null;
            this.setDOM(this.widget.toDOM(view));
            if (!this.widget.editable)
                this.dom.contentEditable = "false";
        }
    }
    getSide() { return this.side; }
    merge(from, to, source, hasStart, openStart, openEnd) {
        if (source && (!(source instanceof WidgetView) || !this.widget.compare(source.widget) ||
            from > 0 && openStart <= 0 || to < this.length && openEnd <= 0))
            return false;
        this.length = from + (source ? source.length : 0) + (this.length - to);
        return true;
    }
    become(other) {
        if (other instanceof WidgetView && other.side == this.side &&
            this.widget.constructor == other.widget.constructor) {
            if (!this.widget.compare(other.widget))
                this.markDirty(true);
            if (this.dom && !this.prevWidget)
                this.prevWidget = this.widget;
            this.widget = other.widget;
            this.length = other.length;
            return true;
        }
        return false;
    }
    ignoreMutation() { return true; }
    ignoreEvent(event) { return this.widget.ignoreEvent(event); }
    get overrideDOMText() {
        if (this.length == 0)
            return Text.empty;
        let top = this;
        while (top.parent)
            top = top.parent;
        let { view } = top, text = view && view.state.doc, start = this.posAtStart;
        return text ? text.slice(start, start + this.length) : Text.empty;
    }
    domAtPos(pos) {
        return (this.length ? pos == 0 : this.side > 0)
            ? DOMPos.before(this.dom)
            : DOMPos.after(this.dom, pos == this.length);
    }
    domBoundsAround() { return null; }
    coordsAt(pos, side) {
        let custom = this.widget.coordsAt(this.dom, pos, side);
        if (custom)
            return custom;
        let rects = this.dom.getClientRects(), rect = null;
        if (!rects.length)
            return null;
        let fromBack = this.side ? this.side < 0 : pos > 0;
        for (let i = fromBack ? rects.length - 1 : 0;; i += (fromBack ? -1 : 1)) {
            rect = rects[i];
            if (pos > 0 ? i == 0 : i == rects.length - 1 || rect.top < rect.bottom)
                break;
        }
        return flattenRect(rect, !fromBack);
    }
    get isEditable() { return false; }
    get isWidget() { return true; }
    get isHidden() { return this.widget.isHidden; }
    destroy() {
        super.destroy();
        if (this.dom)
            this.widget.destroy(this.dom);
    }
}
// These are drawn around uneditable widgets to avoid a number of
// browser bugs that show up when the cursor is directly next to
// uneditable inline content.
class WidgetBufferView extends ContentView {
    constructor(side) {
        super();
        this.side = side;
    }
    get length() { return 0; }
    merge() { return false; }
    become(other) {
        return other instanceof WidgetBufferView && other.side == this.side;
    }
    split() { return new WidgetBufferView(this.side); }
    sync() {
        if (!this.dom) {
            let dom = document.createElement("img");
            dom.className = "cm-widgetBuffer";
            dom.setAttribute("aria-hidden", "true");
            this.setDOM(dom);
        }
    }
    getSide() { return this.side; }
    domAtPos(pos) { return this.side > 0 ? DOMPos.before(this.dom) : DOMPos.after(this.dom); }
    localPosFromDOM() { return 0; }
    domBoundsAround() { return null; }
    coordsAt(pos) {
        return this.dom.getBoundingClientRect();
    }
    get overrideDOMText() {
        return Text.empty;
    }
    get isHidden() { return true; }
}
TextView.prototype.children = WidgetView.prototype.children = WidgetBufferView.prototype.children = noChildren;
function inlineDOMAtPos(parent, pos) {
    let dom = parent.dom, { children } = parent, i = 0;
    for (let off = 0; i < children.length; i++) {
        let child = children[i], end = off + child.length;
        if (end == off && child.getSide() <= 0)
            continue;
        if (pos > off && pos < end && child.dom.parentNode == dom)
            return child.domAtPos(pos - off);
        if (pos <= off)
            break;
        off = end;
    }
    for (let j = i; j > 0; j--) {
        let prev = children[j - 1];
        if (prev.dom.parentNode == dom)
            return prev.domAtPos(prev.length);
    }
    for (let j = i; j < children.length; j++) {
        let next = children[j];
        if (next.dom.parentNode == dom)
            return next.domAtPos(0);
    }
    return new DOMPos(dom, 0);
}
// Assumes `view`, if a mark view, has precisely 1 child.
function joinInlineInto(parent, view, open) {
    let last, { children } = parent;
    if (open > 0 && view instanceof MarkView && children.length &&
        (last = children[children.length - 1]) instanceof MarkView && last.mark.eq(view.mark)) {
        joinInlineInto(last, view.children[0], open - 1);
    }
    else {
        children.push(view);
        view.setParent(parent);
    }
    parent.length += view.length;
}
function coordsInChildren(view, pos, side) {
    let before = null, beforePos = -1, after = null, afterPos = -1;
    function scan(view, pos) {
        for (let i = 0, off = 0; i < view.children.length && off <= pos; i++) {
            let child = view.children[i], end = off + child.length;
            if (end >= pos) {
                if (child.children.length) {
                    scan(child, pos - off);
                }
                else if ((!after || after.isHidden && side > 0) &&
                    (end > pos || off == end && child.getSide() > 0)) {
                    after = child;
                    afterPos = pos - off;
                }
                else if (off < pos || (off == end && child.getSide() < 0) && !child.isHidden) {
                    before = child;
                    beforePos = pos - off;
                }
            }
            off = end;
        }
    }
    scan(view, pos);
    let target = (side < 0 ? before : after) || before || after;
    if (target)
        return target.coordsAt(Math.max(0, target == before ? beforePos : afterPos), side);
    return fallbackRect(view);
}
function fallbackRect(view) {
    let last = view.dom.lastChild;
    if (!last)
        return view.dom.getBoundingClientRect();
    let rects = clientRectsFor(last);
    return rects[rects.length - 1] || null;
}

function combineAttrs(source, target) {
    for (let name in source) {
        if (name == "class" && target.class)
            target.class += " " + source.class;
        else if (name == "style" && target.style)
            target.style += ";" + source.style;
        else
            target[name] = source[name];
    }
    return target;
}
const noAttrs = /*@__PURE__*/Object.create(null);
function attrsEq(a, b, ignore) {
    if (a == b)
        return true;
    if (!a)
        a = noAttrs;
    if (!b)
        b = noAttrs;
    let keysA = Object.keys(a), keysB = Object.keys(b);
    if (keysA.length - (ignore && keysA.indexOf(ignore) > -1 ? 1 : 0) !=
        keysB.length - (ignore && keysB.indexOf(ignore) > -1 ? 1 : 0))
        return false;
    for (let key of keysA) {
        if (key != ignore && (keysB.indexOf(key) == -1 || a[key] !== b[key]))
            return false;
    }
    return true;
}
function updateAttrs(dom, prev, attrs) {
    let changed = false;
    if (prev)
        for (let name in prev)
            if (!(attrs && name in attrs)) {
                changed = true;
                if (name == "style")
                    dom.style.cssText = "";
                else
                    dom.removeAttribute(name);
            }
    if (attrs)
        for (let name in attrs)
            if (!(prev && prev[name] == attrs[name])) {
                changed = true;
                if (name == "style")
                    dom.style.cssText = attrs[name];
                else
                    dom.setAttribute(name, attrs[name]);
            }
    return changed;
}
function getAttrs(dom) {
    let attrs = Object.create(null);
    for (let i = 0; i < dom.attributes.length; i++) {
        let attr = dom.attributes[i];
        attrs[attr.name] = attr.value;
    }
    return attrs;
}

class LineView extends ContentView {
    constructor() {
        super(...arguments);
        this.children = [];
        this.length = 0;
        this.prevAttrs = undefined;
        this.attrs = null;
        this.breakAfter = 0;
    }
    // Consumes source
    merge(from, to, source, hasStart, openStart, openEnd) {
        if (source) {
            if (!(source instanceof LineView))
                return false;
            if (!this.dom)
                source.transferDOM(this); // Reuse source.dom when appropriate
        }
        if (hasStart)
            this.setDeco(source ? source.attrs : null);
        mergeChildrenInto(this, from, to, source ? source.children.slice() : [], openStart, openEnd);
        return true;
    }
    split(at) {
        let end = new LineView;
        end.breakAfter = this.breakAfter;
        if (this.length == 0)
            return end;
        let { i, off } = this.childPos(at);
        if (off) {
            end.append(this.children[i].split(off), 0);
            this.children[i].merge(off, this.children[i].length, null, false, 0, 0);
            i++;
        }
        for (let j = i; j < this.children.length; j++)
            end.append(this.children[j], 0);
        while (i > 0 && this.children[i - 1].length == 0)
            this.children[--i].destroy();
        this.children.length = i;
        this.markDirty();
        this.length = at;
        return end;
    }
    transferDOM(other) {
        if (!this.dom)
            return;
        this.markDirty();
        other.setDOM(this.dom);
        other.prevAttrs = this.prevAttrs === undefined ? this.attrs : this.prevAttrs;
        this.prevAttrs = undefined;
        this.dom = null;
    }
    setDeco(attrs) {
        if (!attrsEq(this.attrs, attrs)) {
            if (this.dom) {
                this.prevAttrs = this.attrs;
                this.markDirty();
            }
            this.attrs = attrs;
        }
    }
    append(child, openStart) {
        joinInlineInto(this, child, openStart);
    }
    // Only called when building a line view in ContentBuilder
    addLineDeco(deco) {
        let attrs = deco.spec.attributes, cls = deco.spec.class;
        if (attrs)
            this.attrs = combineAttrs(attrs, this.attrs || {});
        if (cls)
            this.attrs = combineAttrs({ class: cls }, this.attrs || {});
    }
    domAtPos(pos) {
        return inlineDOMAtPos(this, pos);
    }
    reuseDOM(node) {
        if (node.nodeName == "DIV") {
            this.setDOM(node);
            this.flags |= 4 /* ViewFlag.AttrsDirty */ | 2 /* ViewFlag.NodeDirty */;
        }
    }
    sync(view, track) {
        var _a;
        if (!this.dom) {
            this.setDOM(document.createElement("div"));
            this.dom.className = "cm-line";
            this.prevAttrs = this.attrs ? null : undefined;
        }
        else if (this.flags & 4 /* ViewFlag.AttrsDirty */) {
            clearAttributes(this.dom);
            this.dom.className = "cm-line";
            this.prevAttrs = this.attrs ? null : undefined;
        }
        if (this.prevAttrs !== undefined) {
            updateAttrs(this.dom, this.prevAttrs, this.attrs);
            this.dom.classList.add("cm-line");
            this.prevAttrs = undefined;
        }
        super.sync(view, track);
        let last = this.dom.lastChild;
        while (last && ContentView.get(last) instanceof MarkView)
            last = last.lastChild;
        if (!last || !this.length ||
            last.nodeName != "BR" && ((_a = ContentView.get(last)) === null || _a === void 0 ? void 0 : _a.isEditable) == false &&
                (!browser.ios || !this.children.some(ch => ch instanceof TextView))) {
            let hack = document.createElement("BR");
            hack.cmIgnore = true;
            this.dom.appendChild(hack);
        }
    }
    measureTextSize() {
        if (this.children.length == 0 || this.length > 20)
            return null;
        let totalWidth = 0, textHeight;
        for (let child of this.children) {
            if (!(child instanceof TextView) || /[^ -~]/.test(child.text))
                return null;
            let rects = clientRectsFor(child.dom);
            if (rects.length != 1)
                return null;
            totalWidth += rects[0].width;
            textHeight = rects[0].height;
        }
        return !totalWidth ? null : {
            lineHeight: this.dom.getBoundingClientRect().height,
            charWidth: totalWidth / this.length,
            textHeight
        };
    }
    coordsAt(pos, side) {
        let rect = coordsInChildren(this, pos, side);
        // Correct rectangle height for empty lines when the returned
        // height is larger than the text height.
        if (!this.children.length && rect && this.parent) {
            let { heightOracle } = this.parent.view.viewState, height = rect.bottom - rect.top;
            if (Math.abs(height - heightOracle.lineHeight) < 2 && heightOracle.textHeight < height) {
                let dist = (height - heightOracle.textHeight) / 2;
                return { top: rect.top + dist, bottom: rect.bottom - dist, left: rect.left, right: rect.left };
            }
        }
        return rect;
    }
    become(other) {
        return other instanceof LineView && this.children.length == 0 && other.children.length == 0 &&
            attrsEq(this.attrs, other.attrs) && this.breakAfter == other.breakAfter;
    }
    covers() { return true; }
    static find(docView, pos) {
        for (let i = 0, off = 0; i < docView.children.length; i++) {
            let block = docView.children[i], end = off + block.length;
            if (end >= pos) {
                if (block instanceof LineView)
                    return block;
                if (end > pos)
                    break;
            }
            off = end + block.breakAfter;
        }
        return null;
    }
}
class BlockWidgetView extends ContentView {
    constructor(widget, length, deco) {
        super();
        this.widget = widget;
        this.length = length;
        this.deco = deco;
        this.breakAfter = 0;
        this.prevWidget = null;
    }
    merge(from, to, source, _takeDeco, openStart, openEnd) {
        if (source && (!(source instanceof BlockWidgetView) || !this.widget.compare(source.widget) ||
            from > 0 && openStart <= 0 || to < this.length && openEnd <= 0))
            return false;
        this.length = from + (source ? source.length : 0) + (this.length - to);
        return true;
    }
    domAtPos(pos) {
        return pos == 0 ? DOMPos.before(this.dom) : DOMPos.after(this.dom, pos == this.length);
    }
    split(at) {
        let len = this.length - at;
        this.length = at;
        let end = new BlockWidgetView(this.widget, len, this.deco);
        end.breakAfter = this.breakAfter;
        return end;
    }
    get children() { return noChildren; }
    sync(view) {
        if (!this.dom || !this.widget.updateDOM(this.dom, view)) {
            if (this.dom && this.prevWidget)
                this.prevWidget.destroy(this.dom);
            this.prevWidget = null;
            this.setDOM(this.widget.toDOM(view));
            if (!this.widget.editable)
                this.dom.contentEditable = "false";
        }
    }
    get overrideDOMText() {
        return this.parent ? this.parent.view.state.doc.slice(this.posAtStart, this.posAtEnd) : Text.empty;
    }
    domBoundsAround() { return null; }
    become(other) {
        if (other instanceof BlockWidgetView &&
            other.widget.constructor == this.widget.constructor) {
            if (!other.widget.compare(this.widget))
                this.markDirty(true);
            if (this.dom && !this.prevWidget)
                this.prevWidget = this.widget;
            this.widget = other.widget;
            this.length = other.length;
            this.deco = other.deco;
            this.breakAfter = other.breakAfter;
            return true;
        }
        return false;
    }
    ignoreMutation() { return true; }
    ignoreEvent(event) { return this.widget.ignoreEvent(event); }
    get isEditable() { return false; }
    get isWidget() { return true; }
    coordsAt(pos, side) {
        return this.widget.coordsAt(this.dom, pos, side);
    }
    destroy() {
        super.destroy();
        if (this.dom)
            this.widget.destroy(this.dom);
    }
    covers(side) {
        let { startSide, endSide } = this.deco;
        return startSide == endSide ? false : side < 0 ? startSide < 0 : endSide > 0;
    }
}

/**
Widgets added to the content are described by subclasses of this
class. Using a description object like that makes it possible to
delay creating of the DOM structure for a widget until it is
needed, and to avoid redrawing widgets even if the decorations
that define them are recreated.
*/
class WidgetType {
    /**
    Compare this instance to another instance of the same type.
    (TypeScript can't express this, but only instances of the same
    specific class will be passed to this method.) This is used to
    avoid redrawing widgets when they are replaced by a new
    decoration of the same type. The default implementation just
    returns `false`, which will cause new instances of the widget to
    always be redrawn.
    */
    eq(widget) { return false; }
    /**
    Update a DOM element created by a widget of the same type (but
    different, non-`eq` content) to reflect this widget. May return
    true to indicate that it could update, false to indicate it
    couldn't (in which case the widget will be redrawn). The default
    implementation just returns false.
    */
    updateDOM(dom, view) { return false; }
    /**
    @internal
    */
    compare(other) {
        return this == other || this.constructor == other.constructor && this.eq(other);
    }
    /**
    The estimated height this widget will have, to be used when
    estimating the height of content that hasn't been drawn. May
    return -1 to indicate you don't know. The default implementation
    returns -1.
    */
    get estimatedHeight() { return -1; }
    /**
    For inline widgets that are displayed inline (as opposed to
    `inline-block`) and introduce line breaks (through `<br>` tags
    or textual newlines), this must indicate the amount of line
    breaks they introduce. Defaults to 0.
    */
    get lineBreaks() { return 0; }
    /**
    Can be used to configure which kinds of events inside the widget
    should be ignored by the editor. The default is to ignore all
    events.
    */
    ignoreEvent(event) { return true; }
    /**
    Override the way screen coordinates for positions at/in the
    widget are found. `pos` will be the offset into the widget, and
    `side` the side of the position that is being queried—less than
    zero for before, greater than zero for after, and zero for
    directly at that position.
    */
    coordsAt(dom, pos, side) { return null; }
    /**
    @internal
    */
    get isHidden() { return false; }
    /**
    @internal
    */
    get editable() { return false; }
    /**
    This is called when the an instance of the widget is removed
    from the editor view.
    */
    destroy(dom) { }
}
/**
The different types of blocks that can occur in an editor view.
*/
var BlockType = /*@__PURE__*/(function (BlockType) {
    /**
    A line of text.
    */
    BlockType[BlockType["Text"] = 0] = "Text";
    /**
    A block widget associated with the position after it.
    */
    BlockType[BlockType["WidgetBefore"] = 1] = "WidgetBefore";
    /**
    A block widget associated with the position before it.
    */
    BlockType[BlockType["WidgetAfter"] = 2] = "WidgetAfter";
    /**
    A block widget [replacing](https://codemirror.net/6/docs/ref/#view.Decoration^replace) a range of content.
    */
    BlockType[BlockType["WidgetRange"] = 3] = "WidgetRange";
return BlockType})(BlockType || (BlockType = {}));
/**
A decoration provides information on how to draw or style a piece
of content. You'll usually use it wrapped in a
[`Range`](https://codemirror.net/6/docs/ref/#state.Range), which adds a start and end position.
@nonabstract
*/
class Decoration extends RangeValue {
    constructor(
    /**
    @internal
    */
    startSide, 
    /**
    @internal
    */
    endSide, 
    /**
    @internal
    */
    widget, 
    /**
    The config object used to create this decoration. You can
    include additional properties in there to store metadata about
    your decoration.
    */
    spec) {
        super();
        this.startSide = startSide;
        this.endSide = endSide;
        this.widget = widget;
        this.spec = spec;
    }
    /**
    @internal
    */
    get heightRelevant() { return false; }
    /**
    Create a mark decoration, which influences the styling of the
    content in its range. Nested mark decorations will cause nested
    DOM elements to be created. Nesting order is determined by
    precedence of the [facet](https://codemirror.net/6/docs/ref/#view.EditorView^decorations), with
    the higher-precedence decorations creating the inner DOM nodes.
    Such elements are split on line boundaries and on the boundaries
    of lower-precedence decorations.
    */
    static mark(spec) {
        return new MarkDecoration(spec);
    }
    /**
    Create a widget decoration, which displays a DOM element at the
    given position.
    */
    static widget(spec) {
        let side = Math.max(-10000, Math.min(10000, spec.side || 0)), block = !!spec.block;
        side += (block && !spec.inlineOrder)
            ? (side > 0 ? 300000000 /* Side.BlockAfter */ : -400000000 /* Side.BlockBefore */)
            : (side > 0 ? 100000000 /* Side.InlineAfter */ : -100000000 /* Side.InlineBefore */);
        return new PointDecoration(spec, side, side, block, spec.widget || null, false);
    }
    /**
    Create a replace decoration which replaces the given range with
    a widget, or simply hides it.
    */
    static replace(spec) {
        let block = !!spec.block, startSide, endSide;
        if (spec.isBlockGap) {
            startSide = -500000000 /* Side.GapStart */;
            endSide = 400000000 /* Side.GapEnd */;
        }
        else {
            let { start, end } = getInclusive(spec, block);
            startSide = (start ? (block ? -300000000 /* Side.BlockIncStart */ : -1 /* Side.InlineIncStart */) : 500000000 /* Side.NonIncStart */) - 1;
            endSide = (end ? (block ? 200000000 /* Side.BlockIncEnd */ : 1 /* Side.InlineIncEnd */) : -600000000 /* Side.NonIncEnd */) + 1;
        }
        return new PointDecoration(spec, startSide, endSide, block, spec.widget || null, true);
    }
    /**
    Create a line decoration, which can add DOM attributes to the
    line starting at the given position.
    */
    static line(spec) {
        return new LineDecoration(spec);
    }
    /**
    Build a [`DecorationSet`](https://codemirror.net/6/docs/ref/#view.DecorationSet) from the given
    decorated range or ranges. If the ranges aren't already sorted,
    pass `true` for `sort` to make the library sort them for you.
    */
    static set(of, sort = false) {
        return RangeSet.of(of, sort);
    }
    /**
    @internal
    */
    hasHeight() { return this.widget ? this.widget.estimatedHeight > -1 : false; }
}
/**
The empty set of decorations.
*/
Decoration.none = RangeSet.empty;
class MarkDecoration extends Decoration {
    constructor(spec) {
        let { start, end } = getInclusive(spec);
        super(start ? -1 /* Side.InlineIncStart */ : 500000000 /* Side.NonIncStart */, end ? 1 /* Side.InlineIncEnd */ : -600000000 /* Side.NonIncEnd */, null, spec);
        this.tagName = spec.tagName || "span";
        this.class = spec.class || "";
        this.attrs = spec.attributes || null;
    }
    eq(other) {
        var _a, _b;
        return this == other ||
            other instanceof MarkDecoration &&
                this.tagName == other.tagName &&
                (this.class || ((_a = this.attrs) === null || _a === void 0 ? void 0 : _a.class)) == (other.class || ((_b = other.attrs) === null || _b === void 0 ? void 0 : _b.class)) &&
                attrsEq(this.attrs, other.attrs, "class");
    }
    range(from, to = from) {
        if (from >= to)
            throw new RangeError("Mark decorations may not be empty");
        return super.range(from, to);
    }
}
MarkDecoration.prototype.point = false;
class LineDecoration extends Decoration {
    constructor(spec) {
        super(-200000000 /* Side.Line */, -200000000 /* Side.Line */, null, spec);
    }
    eq(other) {
        return other instanceof LineDecoration &&
            this.spec.class == other.spec.class &&
            attrsEq(this.spec.attributes, other.spec.attributes);
    }
    range(from, to = from) {
        if (to != from)
            throw new RangeError("Line decoration ranges must be zero-length");
        return super.range(from, to);
    }
}
LineDecoration.prototype.mapMode = MapMode.TrackBefore;
LineDecoration.prototype.point = true;
class PointDecoration extends Decoration {
    constructor(spec, startSide, endSide, block, widget, isReplace) {
        super(startSide, endSide, widget, spec);
        this.block = block;
        this.isReplace = isReplace;
        this.mapMode = !block ? MapMode.TrackDel : startSide <= 0 ? MapMode.TrackBefore : MapMode.TrackAfter;
    }
    // Only relevant when this.block == true
    get type() {
        return this.startSide != this.endSide ? BlockType.WidgetRange
            : this.startSide <= 0 ? BlockType.WidgetBefore : BlockType.WidgetAfter;
    }
    get heightRelevant() {
        return this.block || !!this.widget && (this.widget.estimatedHeight >= 5 || this.widget.lineBreaks > 0);
    }
    eq(other) {
        return other instanceof PointDecoration &&
            widgetsEq(this.widget, other.widget) &&
            this.block == other.block &&
            this.startSide == other.startSide && this.endSide == other.endSide;
    }
    range(from, to = from) {
        if (this.isReplace && (from > to || (from == to && this.startSide > 0 && this.endSide <= 0)))
            throw new RangeError("Invalid range for replacement decoration");
        if (!this.isReplace && to != from)
            throw new RangeError("Widget decorations can only have zero-length ranges");
        return super.range(from, to);
    }
}
PointDecoration.prototype.point = true;
function getInclusive(spec, block = false) {
    let { inclusiveStart: start, inclusiveEnd: end } = spec;
    if (start == null)
        start = spec.inclusive;
    if (end == null)
        end = spec.inclusive;
    return { start: start !== null && start !== void 0 ? start : block, end: end !== null && end !== void 0 ? end : block };
}
function widgetsEq(a, b) {
    return a == b || !!(a && b && a.compare(b));
}
function addRange(from, to, ranges, margin = 0) {
    let last = ranges.length - 1;
    if (last >= 0 && ranges[last] + margin >= from)
        ranges[last] = Math.max(ranges[last], to);
    else
        ranges.push(from, to);
}

class ContentBuilder {
    constructor(doc, pos, end, disallowBlockEffectsFor) {
        this.doc = doc;
        this.pos = pos;
        this.end = end;
        this.disallowBlockEffectsFor = disallowBlockEffectsFor;
        this.content = [];
        this.curLine = null;
        this.breakAtStart = 0;
        this.pendingBuffer = 0 /* Buf.No */;
        this.bufferMarks = [];
        // Set to false directly after a widget that covers the position after it
        this.atCursorPos = true;
        this.openStart = -1;
        this.openEnd = -1;
        this.text = "";
        this.textOff = 0;
        this.cursor = doc.iter();
        this.skip = pos;
    }
    posCovered() {
        if (this.content.length == 0)
            return !this.breakAtStart && this.doc.lineAt(this.pos).from != this.pos;
        let last = this.content[this.content.length - 1];
        return !(last.breakAfter || last instanceof BlockWidgetView && last.deco.endSide < 0);
    }
    getLine() {
        if (!this.curLine) {
            this.content.push(this.curLine = new LineView);
            this.atCursorPos = true;
        }
        return this.curLine;
    }
    flushBuffer(active = this.bufferMarks) {
        if (this.pendingBuffer) {
            this.curLine.append(wrapMarks(new WidgetBufferView(-1), active), active.length);
            this.pendingBuffer = 0 /* Buf.No */;
        }
    }
    addBlockWidget(view) {
        this.flushBuffer();
        this.curLine = null;
        this.content.push(view);
    }
    finish(openEnd) {
        if (this.pendingBuffer && openEnd <= this.bufferMarks.length)
            this.flushBuffer();
        else
            this.pendingBuffer = 0 /* Buf.No */;
        if (!this.posCovered() &&
            !(openEnd && this.content.length && this.content[this.content.length - 1] instanceof BlockWidgetView))
            this.getLine();
    }
    buildText(length, active, openStart) {
        while (length > 0) {
            if (this.textOff == this.text.length) {
                let { value, lineBreak, done } = this.cursor.next(this.skip);
                this.skip = 0;
                if (done)
                    throw new Error("Ran out of text content when drawing inline views");
                if (lineBreak) {
                    if (!this.posCovered())
                        this.getLine();
                    if (this.content.length)
                        this.content[this.content.length - 1].breakAfter = 1;
                    else
                        this.breakAtStart = 1;
                    this.flushBuffer();
                    this.curLine = null;
                    this.atCursorPos = true;
                    length--;
                    continue;
                }
                else {
                    this.text = value;
                    this.textOff = 0;
                }
            }
            let take = Math.min(this.text.length - this.textOff, length, 512 /* T.Chunk */);
            this.flushBuffer(active.slice(active.length - openStart));
            this.getLine().append(wrapMarks(new TextView(this.text.slice(this.textOff, this.textOff + take)), active), openStart);
            this.atCursorPos = true;
            this.textOff += take;
            length -= take;
            openStart = 0;
        }
    }
    span(from, to, active, openStart) {
        this.buildText(to - from, active, openStart);
        this.pos = to;
        if (this.openStart < 0)
            this.openStart = openStart;
    }
    point(from, to, deco, active, openStart, index) {
        if (this.disallowBlockEffectsFor[index] && deco instanceof PointDecoration) {
            if (deco.block)
                throw new RangeError("Block decorations may not be specified via plugins");
            if (to > this.doc.lineAt(this.pos).to)
                throw new RangeError("Decorations that replace line breaks may not be specified via plugins");
        }
        let len = to - from;
        if (deco instanceof PointDecoration) {
            if (deco.block) {
                if (deco.startSide > 0 && !this.posCovered())
                    this.getLine();
                this.addBlockWidget(new BlockWidgetView(deco.widget || NullWidget.block, len, deco));
            }
            else {
                let view = WidgetView.create(deco.widget || NullWidget.inline, len, len ? 0 : deco.startSide);
                let cursorBefore = this.atCursorPos && !view.isEditable && openStart <= active.length &&
                    (from < to || deco.startSide > 0);
                let cursorAfter = !view.isEditable && (from < to || openStart > active.length || deco.startSide <= 0);
                let line = this.getLine();
                if (this.pendingBuffer == 2 /* Buf.IfCursor */ && !cursorBefore && !view.isEditable)
                    this.pendingBuffer = 0 /* Buf.No */;
                this.flushBuffer(active);
                if (cursorBefore) {
                    line.append(wrapMarks(new WidgetBufferView(1), active), openStart);
                    openStart = active.length + Math.max(0, openStart - active.length);
                }
                line.append(wrapMarks(view, active), openStart);
                this.atCursorPos = cursorAfter;
                this.pendingBuffer = !cursorAfter ? 0 /* Buf.No */ : from < to || openStart > active.length ? 1 /* Buf.Yes */ : 2 /* Buf.IfCursor */;
                if (this.pendingBuffer)
                    this.bufferMarks = active.slice();
            }
        }
        else if (this.doc.lineAt(this.pos).from == this.pos) { // Line decoration
            this.getLine().addLineDeco(deco);
        }
        if (len) {
            // Advance the iterator past the replaced content
            if (this.textOff + len <= this.text.length) {
                this.textOff += len;
            }
            else {
                this.skip += len - (this.text.length - this.textOff);
                this.text = "";
                this.textOff = 0;
            }
            this.pos = to;
        }
        if (this.openStart < 0)
            this.openStart = openStart;
    }
    static build(text, from, to, decorations, dynamicDecorationMap) {
        let builder = new ContentBuilder(text, from, to, dynamicDecorationMap);
        builder.openEnd = RangeSet.spans(decorations, from, to, builder);
        if (builder.openStart < 0)
            builder.openStart = builder.openEnd;
        builder.finish(builder.openEnd);
        return builder;
    }
}
function wrapMarks(view, active) {
    for (let mark of active)
        view = new MarkView(mark, [view], view.length);
    return view;
}
class NullWidget extends WidgetType {
    constructor(tag) {
        super();
        this.tag = tag;
    }
    eq(other) { return other.tag == this.tag; }
    toDOM() { return document.createElement(this.tag); }
    updateDOM(elt) { return elt.nodeName.toLowerCase() == this.tag; }
    get isHidden() { return true; }
}
NullWidget.inline = /*@__PURE__*/new NullWidget("span");
NullWidget.block = /*@__PURE__*/new NullWidget("div");

/**
Used to indicate [text direction](https://codemirror.net/6/docs/ref/#view.EditorView.textDirection).
*/
var Direction = /*@__PURE__*/(function (Direction) {
    // (These are chosen to match the base levels, in bidi algorithm
    // terms, of spans in that direction.)
    /**
    Left-to-right.
    */
    Direction[Direction["LTR"] = 0] = "LTR";
    /**
    Right-to-left.
    */
    Direction[Direction["RTL"] = 1] = "RTL";
return Direction})(Direction || (Direction = {}));
const LTR = Direction.LTR, RTL = Direction.RTL;
// Decode a string with each type encoded as log2(type)
function dec(str) {
    let result = [];
    for (let i = 0; i < str.length; i++)
        result.push(1 << +str[i]);
    return result;
}
// Character types for codepoints 0 to 0xf8
const LowTypes = /*@__PURE__*/dec("88888888888888888888888888888888888666888888787833333333337888888000000000000000000000000008888880000000000000000000000000088888888888888888888888888888888888887866668888088888663380888308888800000000000000000000000800000000000000000000000000000008");
// Character types for codepoints 0x600 to 0x6f9
const ArabicTypes = /*@__PURE__*/dec("4444448826627288999999999992222222222222222222222222222222222222222222222229999999999999999999994444444444644222822222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222999999949999999229989999223333333333");
const Brackets = /*@__PURE__*/Object.create(null), BracketStack = [];
// There's a lot more in
// https://www.unicode.org/Public/UCD/latest/ucd/BidiBrackets.txt,
// which are left out to keep code size down.
for (let p of ["()", "[]", "{}"]) {
    let l = /*@__PURE__*/p.charCodeAt(0), r = /*@__PURE__*/p.charCodeAt(1);
    Brackets[l] = r;
    Brackets[r] = -l;
}
function charType(ch) {
    return ch <= 0xf7 ? LowTypes[ch] :
        0x590 <= ch && ch <= 0x5f4 ? 2 /* T.R */ :
            0x600 <= ch && ch <= 0x6f9 ? ArabicTypes[ch - 0x600] :
                0x6ee <= ch && ch <= 0x8ac ? 4 /* T.AL */ :
                    0x2000 <= ch && ch <= 0x200c ? 256 /* T.NI */ :
                        0xfb50 <= ch && ch <= 0xfdff ? 4 /* T.AL */ : 1 /* T.L */;
}
const BidiRE = /[\u0590-\u05f4\u0600-\u06ff\u0700-\u08ac\ufb50-\ufdff]/;
/**
Represents a contiguous range of text that has a single direction
(as in left-to-right or right-to-left).
*/
class BidiSpan {
    /**
    The direction of this span.
    */
    get dir() { return this.level % 2 ? RTL : LTR; }
    /**
    @internal
    */
    constructor(
    /**
    The start of the span (relative to the start of the line).
    */
    from, 
    /**
    The end of the span.
    */
    to, 
    /**
    The ["bidi
    level"](https://unicode.org/reports/tr9/#Basic_Display_Algorithm)
    of the span (in this context, 0 means
    left-to-right, 1 means right-to-left, 2 means left-to-right
    number inside right-to-left text).
    */
    level) {
        this.from = from;
        this.to = to;
        this.level = level;
    }
    /**
    @internal
    */
    side(end, dir) { return (this.dir == dir) == end ? this.to : this.from; }
    /**
    @internal
    */
    forward(forward, dir) { return forward == (this.dir == dir); }
    /**
    @internal
    */
    static find(order, index, level, assoc) {
        let maybe = -1;
        for (let i = 0; i < order.length; i++) {
            let span = order[i];
            if (span.from <= index && span.to >= index) {
                if (span.level == level)
                    return i;
                // When multiple spans match, if assoc != 0, take the one that
                // covers that side, otherwise take the one with the minimum
                // level.
                if (maybe < 0 || (assoc != 0 ? (assoc < 0 ? span.from < index : span.to > index) : order[maybe].level > span.level))
                    maybe = i;
            }
        }
        if (maybe < 0)
            throw new RangeError("Index out of range");
        return maybe;
    }
}
function isolatesEq(a, b) {
    if (a.length != b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        let iA = a[i], iB = b[i];
        if (iA.from != iB.from || iA.to != iB.to || iA.direction != iB.direction || !isolatesEq(iA.inner, iB.inner))
            return false;
    }
    return true;
}
// Reused array of character types
const types = [];
// Fill in the character types (in `types`) from `from` to `to` and
// apply W normalization rules.
function computeCharTypes(line, rFrom, rTo, isolates, outerType) {
    for (let iI = 0; iI <= isolates.length; iI++) {
        let from = iI ? isolates[iI - 1].to : rFrom, to = iI < isolates.length ? isolates[iI].from : rTo;
        let prevType = iI ? 256 /* T.NI */ : outerType;
        // W1. Examine each non-spacing mark (NSM) in the level run, and
        // change the type of the NSM to the type of the previous
        // character. If the NSM is at the start of the level run, it will
        // get the type of sor.
        // W2. Search backwards from each instance of a European number
        // until the first strong type (R, L, AL, or sor) is found. If an
        // AL is found, change the type of the European number to Arabic
        // number.
        // W3. Change all ALs to R.
        // (Left after this: L, R, EN, AN, ET, CS, NI)
        for (let i = from, prev = prevType, prevStrong = prevType; i < to; i++) {
            let type = charType(line.charCodeAt(i));
            if (type == 512 /* T.NSM */)
                type = prev;
            else if (type == 8 /* T.EN */ && prevStrong == 4 /* T.AL */)
                type = 16 /* T.AN */;
            types[i] = type == 4 /* T.AL */ ? 2 /* T.R */ : type;
            if (type & 7 /* T.Strong */)
                prevStrong = type;
            prev = type;
        }
        // W5. A sequence of European terminators adjacent to European
        // numbers changes to all European numbers.
        // W6. Otherwise, separators and terminators change to Other
        // Neutral.
        // W7. Search backwards from each instance of a European number
        // until the first strong type (R, L, or sor) is found. If an L is
        // found, then change the type of the European number to L.
        // (Left after this: L, R, EN+AN, NI)
        for (let i = from, prev = prevType, prevStrong = prevType; i < to; i++) {
            let type = types[i];
            if (type == 128 /* T.CS */) {
                if (i < to - 1 && prev == types[i + 1] && (prev & 24 /* T.Num */))
                    type = types[i] = prev;
                else
                    types[i] = 256 /* T.NI */;
            }
            else if (type == 64 /* T.ET */) {
                let end = i + 1;
                while (end < to && types[end] == 64 /* T.ET */)
                    end++;
                let replace = (i && prev == 8 /* T.EN */) || (end < rTo && types[end] == 8 /* T.EN */) ? (prevStrong == 1 /* T.L */ ? 1 /* T.L */ : 8 /* T.EN */) : 256 /* T.NI */;
                for (let j = i; j < end; j++)
                    types[j] = replace;
                i = end - 1;
            }
            else if (type == 8 /* T.EN */ && prevStrong == 1 /* T.L */) {
                types[i] = 1 /* T.L */;
            }
            prev = type;
            if (type & 7 /* T.Strong */)
                prevStrong = type;
        }
    }
}
// Process brackets throughout a run sequence.
function processBracketPairs(line, rFrom, rTo, isolates, outerType) {
    let oppositeType = outerType == 1 /* T.L */ ? 2 /* T.R */ : 1 /* T.L */;
    for (let iI = 0, sI = 0, context = 0; iI <= isolates.length; iI++) {
        let from = iI ? isolates[iI - 1].to : rFrom, to = iI < isolates.length ? isolates[iI].from : rTo;
        // N0. Process bracket pairs in an isolating run sequence
        // sequentially in the logical order of the text positions of the
        // opening paired brackets using the logic given below. Within this
        // scope, bidirectional types EN and AN are treated as R.
        for (let i = from, ch, br, type; i < to; i++) {
            // Keeps [startIndex, type, strongSeen] triples for each open
            // bracket on BracketStack.
            if (br = Brackets[ch = line.charCodeAt(i)]) {
                if (br < 0) { // Closing bracket
                    for (let sJ = sI - 3; sJ >= 0; sJ -= 3) {
                        if (BracketStack[sJ + 1] == -br) {
                            let flags = BracketStack[sJ + 2];
                            let type = (flags & 2 /* Bracketed.EmbedInside */) ? outerType :
                                !(flags & 4 /* Bracketed.OppositeInside */) ? 0 :
                                    (flags & 1 /* Bracketed.OppositeBefore */) ? oppositeType : outerType;
                            if (type)
                                types[i] = types[BracketStack[sJ]] = type;
                            sI = sJ;
                            break;
                        }
                    }
                }
                else if (BracketStack.length == 189 /* Bracketed.MaxDepth */) {
                    break;
                }
                else {
                    BracketStack[sI++] = i;
                    BracketStack[sI++] = ch;
                    BracketStack[sI++] = context;
                }
            }
            else if ((type = types[i]) == 2 /* T.R */ || type == 1 /* T.L */) {
                let embed = type == outerType;
                context = embed ? 0 : 1 /* Bracketed.OppositeBefore */;
                for (let sJ = sI - 3; sJ >= 0; sJ -= 3) {
                    let cur = BracketStack[sJ + 2];
                    if (cur & 2 /* Bracketed.EmbedInside */)
                        break;
                    if (embed) {
                        BracketStack[sJ + 2] |= 2 /* Bracketed.EmbedInside */;
                    }
                    else {
                        if (cur & 4 /* Bracketed.OppositeInside */)
                            break;
                        BracketStack[sJ + 2] |= 4 /* Bracketed.OppositeInside */;
                    }
                }
            }
        }
    }
}
function processNeutrals(rFrom, rTo, isolates, outerType) {
    for (let iI = 0, prev = outerType; iI <= isolates.length; iI++) {
        let from = iI ? isolates[iI - 1].to : rFrom, to = iI < isolates.length ? isolates[iI].from : rTo;
        // N1. A sequence of neutrals takes the direction of the
        // surrounding strong text if the text on both sides has the same
        // direction. European and Arabic numbers act as if they were R in
        // terms of their influence on neutrals. Start-of-level-run (sor)
        // and end-of-level-run (eor) are used at level run boundaries.
        // N2. Any remaining neutrals take the embedding direction.
        // (Left after this: L, R, EN+AN)
        for (let i = from; i < to;) {
            let type = types[i];
            if (type == 256 /* T.NI */) {
                let end = i + 1;
                for (;;) {
                    if (end == to) {
                        if (iI == isolates.length)
                            break;
                        end = isolates[iI++].to;
                        to = iI < isolates.length ? isolates[iI].from : rTo;
                    }
                    else if (types[end] == 256 /* T.NI */) {
                        end++;
                    }
                    else {
                        break;
                    }
                }
                let beforeL = prev == 1 /* T.L */;
                let afterL = (end < rTo ? types[end] : outerType) == 1 /* T.L */;
                let replace = beforeL == afterL ? (beforeL ? 1 /* T.L */ : 2 /* T.R */) : outerType;
                for (let j = end, jI = iI, fromJ = jI ? isolates[jI - 1].to : rFrom; j > i;) {
                    if (j == fromJ) {
                        j = isolates[--jI].from;
                        fromJ = jI ? isolates[jI - 1].to : rFrom;
                    }
                    types[--j] = replace;
                }
                i = end;
            }
            else {
                prev = type;
                i++;
            }
        }
    }
}
// Find the contiguous ranges of character types in a given range, and
// emit spans for them. Flip the order of the spans as appropriate
// based on the level, and call through to compute the spans for
// isolates at the proper point.
function emitSpans(line, from, to, level, baseLevel, isolates, order) {
    let ourType = level % 2 ? 2 /* T.R */ : 1 /* T.L */;
    if ((level % 2) == (baseLevel % 2)) { // Same dir as base direction, don't flip
        for (let iCh = from, iI = 0; iCh < to;) {
            // Scan a section of characters in direction ourType, unless
            // there's another type of char right after iCh, in which case
            // we scan a section of other characters (which, if ourType ==
            // T.L, may contain both T.R and T.AN chars).
            let sameDir = true, isNum = false;
            if (iI == isolates.length || iCh < isolates[iI].from) {
                let next = types[iCh];
                if (next != ourType) {
                    sameDir = false;
                    isNum = next == 16 /* T.AN */;
                }
            }
            // Holds an array of isolates to pass to a recursive call if we
            // must recurse (to distinguish T.AN inside an RTL section in
            // LTR text), null if we can emit directly
            let recurse = !sameDir && ourType == 1 /* T.L */ ? [] : null;
            let localLevel = sameDir ? level : level + 1;
            let iScan = iCh;
            run: for (;;) {
                if (iI < isolates.length && iScan == isolates[iI].from) {
                    if (isNum)
                        break run;
                    let iso = isolates[iI];
                    // Scan ahead to verify that there is another char in this dir after the isolate(s)
                    if (!sameDir)
                        for (let upto = iso.to, jI = iI + 1;;) {
                            if (upto == to)
                                break run;
                            if (jI < isolates.length && isolates[jI].from == upto)
                                upto = isolates[jI++].to;
                            else if (types[upto] == ourType)
                                break run;
                            else
                                break;
                        }
                    iI++;
                    if (recurse) {
                        recurse.push(iso);
                    }
                    else {
                        if (iso.from > iCh)
                            order.push(new BidiSpan(iCh, iso.from, localLevel));
                        let dirSwap = (iso.direction == LTR) != !(localLevel % 2);
                        computeSectionOrder(line, dirSwap ? level + 1 : level, baseLevel, iso.inner, iso.from, iso.to, order);
                        iCh = iso.to;
                    }
                    iScan = iso.to;
                }
                else if (iScan == to || (sameDir ? types[iScan] != ourType : types[iScan] == ourType)) {
                    break;
                }
                else {
                    iScan++;
                }
            }
            if (recurse)
                emitSpans(line, iCh, iScan, level + 1, baseLevel, recurse, order);
            else if (iCh < iScan)
                order.push(new BidiSpan(iCh, iScan, localLevel));
            iCh = iScan;
        }
    }
    else {
        // Iterate in reverse to flip the span order. Same code again, but
        // going from the back of the section to the front
        for (let iCh = to, iI = isolates.length; iCh > from;) {
            let sameDir = true, isNum = false;
            if (!iI || iCh > isolates[iI - 1].to) {
                let next = types[iCh - 1];
                if (next != ourType) {
                    sameDir = false;
                    isNum = next == 16 /* T.AN */;
                }
            }
            let recurse = !sameDir && ourType == 1 /* T.L */ ? [] : null;
            let localLevel = sameDir ? level : level + 1;
            let iScan = iCh;
            run: for (;;) {
                if (iI && iScan == isolates[iI - 1].to) {
                    if (isNum)
                        break run;
                    let iso = isolates[--iI];
                    // Scan ahead to verify that there is another char in this dir after the isolate(s)
                    if (!sameDir)
                        for (let upto = iso.from, jI = iI;;) {
                            if (upto == from)
                                break run;
                            if (jI && isolates[jI - 1].to == upto)
                                upto = isolates[--jI].from;
                            else if (types[upto - 1] == ourType)
                                break run;
                            else
                                break;
                        }
                    if (recurse) {
                        recurse.push(iso);
                    }
                    else {
                        if (iso.to < iCh)
                            order.push(new BidiSpan(iso.to, iCh, localLevel));
                        let dirSwap = (iso.direction == LTR) != !(localLevel % 2);
                        computeSectionOrder(line, dirSwap ? level + 1 : level, baseLevel, iso.inner, iso.from, iso.to, order);
                        iCh = iso.from;
                    }
                    iScan = iso.from;
                }
                else if (iScan == from || (sameDir ? types[iScan - 1] != ourType : types[iScan - 1] == ourType)) {
                    break;
                }
                else {
                    iScan--;
                }
            }
            if (recurse)
                emitSpans(line, iScan, iCh, level + 1, baseLevel, recurse, order);
            else if (iScan < iCh)
                order.push(new BidiSpan(iScan, iCh, localLevel));
            iCh = iScan;
        }
    }
}
function computeSectionOrder(line, level, baseLevel, isolates, from, to, order) {
    let outerType = (level % 2 ? 2 /* T.R */ : 1 /* T.L */);
    computeCharTypes(line, from, to, isolates, outerType);
    processBracketPairs(line, from, to, isolates, outerType);
    processNeutrals(from, to, isolates, outerType);
    emitSpans(line, from, to, level, baseLevel, isolates, order);
}
function computeOrder(line, direction, isolates) {
    if (!line)
        return [new BidiSpan(0, 0, direction == RTL ? 1 : 0)];
    if (direction == LTR && !isolates.length && !BidiRE.test(line))
        return trivialOrder(line.length);
    if (isolates.length)
        while (line.length > types.length)
            types[types.length] = 256 /* T.NI */; // Make sure types array has no gaps
    let order = [], level = direction == LTR ? 0 : 1;
    computeSectionOrder(line, level, level, isolates, 0, line.length, order);
    return order;
}
function trivialOrder(length) {
    return [new BidiSpan(0, length, 0)];
}
let movedOver = "";
// This implementation moves strictly visually, without concern for a
// traversal visiting every logical position in the string. It will
// still do so for simple input, but situations like multiple isolates
// with the same level next to each other, or text going against the
// main dir at the end of the line, will make some positions
// unreachable with this motion. Each visible cursor position will
// correspond to the lower-level bidi span that touches it.
//
// The alternative would be to solve an order globally for a given
// line, making sure that it includes every position, but that would
// require associating non-canonical (higher bidi span level)
// positions with a given visual position, which is likely to confuse
// people. (And would generally be a lot more complicated.)
function moveVisually(line, order, dir, start, forward) {
    var _a;
    let startIndex = start.head - line.from;
    let spanI = BidiSpan.find(order, startIndex, (_a = start.bidiLevel) !== null && _a !== void 0 ? _a : -1, start.assoc);
    let span = order[spanI], spanEnd = span.side(forward, dir);
    // End of span
    if (startIndex == spanEnd) {
        let nextI = spanI += forward ? 1 : -1;
        if (nextI < 0 || nextI >= order.length)
            return null;
        span = order[spanI = nextI];
        startIndex = span.side(!forward, dir);
        spanEnd = span.side(forward, dir);
    }
    let nextIndex = findClusterBreak(line.text, startIndex, span.forward(forward, dir));
    if (nextIndex < span.from || nextIndex > span.to)
        nextIndex = spanEnd;
    movedOver = line.text.slice(Math.min(startIndex, nextIndex), Math.max(startIndex, nextIndex));
    let nextSpan = spanI == (forward ? order.length - 1 : 0) ? null : order[spanI + (forward ? 1 : -1)];
    if (nextSpan && nextIndex == spanEnd && nextSpan.level + (forward ? 0 : 1) < span.level)
        return EditorSelection.cursor(nextSpan.side(!forward, dir) + line.from, nextSpan.forward(forward, dir) ? 1 : -1, nextSpan.level);
    return EditorSelection.cursor(nextIndex + line.from, span.forward(forward, dir) ? -1 : 1, span.level);
}
function autoDirection(text, from, to) {
    for (let i = from; i < to; i++) {
        let type = charType(text.charCodeAt(i));
        if (type == 1 /* T.L */)
            return LTR;
        if (type == 2 /* T.R */ || type == 4 /* T.AL */)
            return RTL;
    }
    return LTR;
}

const clickAddsSelectionRange = /*@__PURE__*/Facet.define();
const dragMovesSelection$1 = /*@__PURE__*/Facet.define();
const mouseSelectionStyle = /*@__PURE__*/Facet.define();
const exceptionSink = /*@__PURE__*/Facet.define();
const updateListener = /*@__PURE__*/Facet.define();
const inputHandler = /*@__PURE__*/Facet.define();
const focusChangeEffect = /*@__PURE__*/Facet.define();
const perLineTextDirection = /*@__PURE__*/Facet.define({
    combine: values => values.some(x => x)
});
const nativeSelectionHidden = /*@__PURE__*/Facet.define({
    combine: values => values.some(x => x)
});
const scrollHandler = /*@__PURE__*/Facet.define();
class ScrollTarget {
    constructor(range, y = "nearest", x = "nearest", yMargin = 5, xMargin = 5, 
    // This data structure is abused to also store precise scroll
    // snapshots, instead of a `scrollIntoView` request. When this
    // flag is `true`, `range` points at a position in the reference
    // line, `yMargin` holds the difference between the top of that
    // line and the top of the editor, and `xMargin` holds the
    // editor's `scrollLeft`.
    isSnapshot = false) {
        this.range = range;
        this.y = y;
        this.x = x;
        this.yMargin = yMargin;
        this.xMargin = xMargin;
        this.isSnapshot = isSnapshot;
    }
    map(changes) {
        return changes.empty ? this :
            new ScrollTarget(this.range.map(changes), this.y, this.x, this.yMargin, this.xMargin, this.isSnapshot);
    }
    clip(state) {
        return this.range.to <= state.doc.length ? this :
            new ScrollTarget(EditorSelection.cursor(state.doc.length), this.y, this.x, this.yMargin, this.xMargin, this.isSnapshot);
    }
}
const scrollIntoView = /*@__PURE__*/StateEffect.define({ map: (t, ch) => t.map(ch) });
const setEditContextFormatting = /*@__PURE__*/StateEffect.define();
/**
Log or report an unhandled exception in client code. Should
probably only be used by extension code that allows client code to
provide functions, and calls those functions in a context where an
exception can't be propagated to calling code in a reasonable way
(for example when in an event handler).

Either calls a handler registered with
[`EditorView.exceptionSink`](https://codemirror.net/6/docs/ref/#view.EditorView^exceptionSink),
`window.onerror`, if defined, or `console.error` (in which case
it'll pass `context`, when given, as first argument).
*/
function logException(state, exception, context) {
    let handler = state.facet(exceptionSink);
    if (handler.length)
        handler[0](exception);
    else if (window.onerror)
        window.onerror(String(exception), context, undefined, undefined, exception);
    else if (context)
        console.error(context + ":", exception);
    else
        console.error(exception);
}
const editable = /*@__PURE__*/Facet.define({ combine: values => values.length ? values[0] : true });
let nextPluginID = 0;
const viewPlugin = /*@__PURE__*/Facet.define();
/**
View plugins associate stateful values with a view. They can
influence the way the content is drawn, and are notified of things
that happen in the view.
*/
class ViewPlugin {
    constructor(
    /**
    @internal
    */
    id, 
    /**
    @internal
    */
    create, 
    /**
    @internal
    */
    domEventHandlers, 
    /**
    @internal
    */
    domEventObservers, buildExtensions) {
        this.id = id;
        this.create = create;
        this.domEventHandlers = domEventHandlers;
        this.domEventObservers = domEventObservers;
        this.extension = buildExtensions(this);
    }
    /**
    Define a plugin from a constructor function that creates the
    plugin's value, given an editor view.
    */
    static define(create, spec) {
        const { eventHandlers, eventObservers, provide, decorations: deco } = spec || {};
        return new ViewPlugin(nextPluginID++, create, eventHandlers, eventObservers, plugin => {
            let ext = [viewPlugin.of(plugin)];
            if (deco)
                ext.push(decorations.of(view => {
                    let pluginInst = view.plugin(plugin);
                    return pluginInst ? deco(pluginInst) : Decoration.none;
                }));
            if (provide)
                ext.push(provide(plugin));
            return ext;
        });
    }
    /**
    Create a plugin for a class whose constructor takes a single
    editor view as argument.
    */
    static fromClass(cls, spec) {
        return ViewPlugin.define(view => new cls(view), spec);
    }
}
class PluginInstance {
    constructor(spec) {
        this.spec = spec;
        // When starting an update, all plugins have this field set to the
        // update object, indicating they need to be updated. When finished
        // updating, it is set to `false`. Retrieving a plugin that needs to
        // be updated with `view.plugin` forces an eager update.
        this.mustUpdate = null;
        // This is null when the plugin is initially created, but
        // initialized on the first update.
        this.value = null;
    }
    update(view) {
        if (!this.value) {
            if (this.spec) {
                try {
                    this.value = this.spec.create(view);
                }
                catch (e) {
                    logException(view.state, e, "CodeMirror plugin crashed");
                    this.deactivate();
                }
            }
        }
        else if (this.mustUpdate) {
            let update = this.mustUpdate;
            this.mustUpdate = null;
            if (this.value.update) {
                try {
                    this.value.update(update);
                }
                catch (e) {
                    logException(update.state, e, "CodeMirror plugin crashed");
                    if (this.value.destroy)
                        try {
                            this.value.destroy();
                        }
                        catch (_) { }
                    this.deactivate();
                }
            }
        }
        return this;
    }
    destroy(view) {
        var _a;
        if ((_a = this.value) === null || _a === void 0 ? void 0 : _a.destroy) {
            try {
                this.value.destroy();
            }
            catch (e) {
                logException(view.state, e, "CodeMirror plugin crashed");
            }
        }
    }
    deactivate() {
        this.spec = this.value = null;
    }
}
const editorAttributes = /*@__PURE__*/Facet.define();
const contentAttributes = /*@__PURE__*/Facet.define();
// Provide decorations
const decorations = /*@__PURE__*/Facet.define();
const outerDecorations = /*@__PURE__*/Facet.define();
const atomicRanges = /*@__PURE__*/Facet.define();
const bidiIsolatedRanges = /*@__PURE__*/Facet.define();
function getIsolatedRanges(view, line) {
    let isolates = view.state.facet(bidiIsolatedRanges);
    if (!isolates.length)
        return isolates;
    let sets = isolates.map(i => i instanceof Function ? i(view) : i);
    let result = [];
    RangeSet.spans(sets, line.from, line.to, {
        point() { },
        span(fromDoc, toDoc, active, open) {
            let from = fromDoc - line.from, to = toDoc - line.from;
            let level = result;
            for (let i = active.length - 1; i >= 0; i--, open--) {
                let direction = active[i].spec.bidiIsolate, update;
                if (direction == null)
                    direction = autoDirection(line.text, from, to);
                if (open > 0 && level.length &&
                    (update = level[level.length - 1]).to == from && update.direction == direction) {
                    update.to = to;
                    level = update.inner;
                }
                else {
                    let add = { from, to, direction, inner: [] };
                    level.push(add);
                    level = add.inner;
                }
            }
        }
    });
    return result;
}
const scrollMargins = /*@__PURE__*/Facet.define();
function getScrollMargins(view) {
    let left = 0, right = 0, top = 0, bottom = 0;
    for (let source of view.state.facet(scrollMargins)) {
        let m = source(view);
        if (m) {
            if (m.left != null)
                left = Math.max(left, m.left);
            if (m.right != null)
                right = Math.max(right, m.right);
            if (m.top != null)
                top = Math.max(top, m.top);
            if (m.bottom != null)
                bottom = Math.max(bottom, m.bottom);
        }
    }
    return { left, right, top, bottom };
}
const styleModule = /*@__PURE__*/Facet.define();
class ChangedRange {
    constructor(fromA, toA, fromB, toB) {
        this.fromA = fromA;
        this.toA = toA;
        this.fromB = fromB;
        this.toB = toB;
    }
    join(other) {
        return new ChangedRange(Math.min(this.fromA, other.fromA), Math.max(this.toA, other.toA), Math.min(this.fromB, other.fromB), Math.max(this.toB, other.toB));
    }
    addToSet(set) {
        let i = set.length, me = this;
        for (; i > 0; i--) {
            let range = set[i - 1];
            if (range.fromA > me.toA)
                continue;
            if (range.toA < me.fromA)
                break;
            me = me.join(range);
            set.splice(i - 1, 1);
        }
        set.splice(i, 0, me);
        return set;
    }
    static extendWithRanges(diff, ranges) {
        if (ranges.length == 0)
            return diff;
        let result = [];
        for (let dI = 0, rI = 0, posA = 0, posB = 0;; dI++) {
            let next = dI == diff.length ? null : diff[dI], off = posA - posB;
            let end = next ? next.fromB : 1e9;
            while (rI < ranges.length && ranges[rI] < end) {
                let from = ranges[rI], to = ranges[rI + 1];
                let fromB = Math.max(posB, from), toB = Math.min(end, to);
                if (fromB <= toB)
                    new ChangedRange(fromB + off, toB + off, fromB, toB).addToSet(result);
                if (to > end)
                    break;
                else
                    rI += 2;
            }
            if (!next)
                return result;
            new ChangedRange(next.fromA, next.toA, next.fromB, next.toB).addToSet(result);
            posA = next.toA;
            posB = next.toB;
        }
    }
}
/**
View [plugins](https://codemirror.net/6/docs/ref/#view.ViewPlugin) are given instances of this
class, which describe what happened, whenever the view is updated.
*/
class ViewUpdate {
    constructor(
    /**
    The editor view that the update is associated with.
    */
    view, 
    /**
    The new editor state.
    */
    state, 
    /**
    The transactions involved in the update. May be empty.
    */
    transactions) {
        this.view = view;
        this.state = state;
        this.transactions = transactions;
        /**
        @internal
        */
        this.flags = 0;
        this.startState = view.state;
        this.changes = ChangeSet.empty(this.startState.doc.length);
        for (let tr of transactions)
            this.changes = this.changes.compose(tr.changes);
        let changedRanges = [];
        this.changes.iterChangedRanges((fromA, toA, fromB, toB) => changedRanges.push(new ChangedRange(fromA, toA, fromB, toB)));
        this.changedRanges = changedRanges;
    }
    /**
    @internal
    */
    static create(view, state, transactions) {
        return new ViewUpdate(view, state, transactions);
    }
    /**
    Tells you whether the [viewport](https://codemirror.net/6/docs/ref/#view.EditorView.viewport) or
    [visible ranges](https://codemirror.net/6/docs/ref/#view.EditorView.visibleRanges) changed in this
    update.
    */
    get viewportChanged() {
        return (this.flags & 4 /* UpdateFlag.Viewport */) > 0;
    }
    /**
    Indicates whether the height of a block element in the editor
    changed in this update.
    */
    get heightChanged() {
        return (this.flags & 2 /* UpdateFlag.Height */) > 0;
    }
    /**
    Returns true when the document was modified or the size of the
    editor, or elements within the editor, changed.
    */
    get geometryChanged() {
        return this.docChanged || (this.flags & (8 /* UpdateFlag.Geometry */ | 2 /* UpdateFlag.Height */)) > 0;
    }
    /**
    True when this update indicates a focus change.
    */
    get focusChanged() {
        return (this.flags & 1 /* UpdateFlag.Focus */) > 0;
    }
    /**
    Whether the document changed in this update.
    */
    get docChanged() {
        return !this.changes.empty;
    }
    /**
    Whether the selection was explicitly set in this update.
    */
    get selectionSet() {
        return this.transactions.some(tr => tr.selection);
    }
    /**
    @internal
    */
    get empty() { return this.flags == 0 && this.transactions.length == 0; }
}

class DocView extends ContentView {
    get length() { return this.view.state.doc.length; }
    constructor(view) {
        super();
        this.view = view;
        this.decorations = [];
        this.dynamicDecorationMap = [false];
        this.domChanged = null;
        this.hasComposition = null;
        this.markedForComposition = new Set;
        this.editContextFormatting = Decoration.none;
        this.lastCompositionAfterCursor = false;
        // Track a minimum width for the editor. When measuring sizes in
        // measureVisibleLineHeights, this is updated to point at the width
        // of a given element and its extent in the document. When a change
        // happens in that range, these are reset. That way, once we've seen
        // a line/element of a given length, we keep the editor wide enough
        // to fit at least that element, until it is changed, at which point
        // we forget it again.
        this.minWidth = 0;
        this.minWidthFrom = 0;
        this.minWidthTo = 0;
        // Track whether the DOM selection was set in a lossy way, so that
        // we don't mess it up when reading it back it
        this.impreciseAnchor = null;
        this.impreciseHead = null;
        this.forceSelection = false;
        // Used by the resize observer to ignore resizes that we caused
        // ourselves
        this.lastUpdate = Date.now();
        this.setDOM(view.contentDOM);
        this.children = [new LineView];
        this.children[0].setParent(this);
        this.updateDeco();
        this.updateInner([new ChangedRange(0, 0, 0, view.state.doc.length)], 0, null);
    }
    // Update the document view to a given state.
    update(update) {
        var _a;
        let changedRanges = update.changedRanges;
        if (this.minWidth > 0 && changedRanges.length) {
            if (!changedRanges.every(({ fromA, toA }) => toA < this.minWidthFrom || fromA > this.minWidthTo)) {
                this.minWidth = this.minWidthFrom = this.minWidthTo = 0;
            }
            else {
                this.minWidthFrom = update.changes.mapPos(this.minWidthFrom, 1);
                this.minWidthTo = update.changes.mapPos(this.minWidthTo, 1);
            }
        }
        this.updateEditContextFormatting(update);
        let readCompositionAt = -1;
        if (this.view.inputState.composing >= 0 && !this.view.observer.editContext) {
            if ((_a = this.domChanged) === null || _a === void 0 ? void 0 : _a.newSel)
                readCompositionAt = this.domChanged.newSel.head;
            else if (!touchesComposition(update.changes, this.hasComposition) && !update.selectionSet)
                readCompositionAt = update.state.selection.main.head;
        }
        let composition = readCompositionAt > -1 ? findCompositionRange(this.view, update.changes, readCompositionAt) : null;
        this.domChanged = null;
        if (this.hasComposition) {
            this.markedForComposition.clear();
            let { from, to } = this.hasComposition;
            changedRanges = new ChangedRange(from, to, update.changes.mapPos(from, -1), update.changes.mapPos(to, 1))
                .addToSet(changedRanges.slice());
        }
        this.hasComposition = composition ? { from: composition.range.fromB, to: composition.range.toB } : null;
        // When the DOM nodes around the selection are moved to another
        // parent, Chrome sometimes reports a different selection through
        // getSelection than the one that it actually shows to the user.
        // This forces a selection update when lines are joined to work
        // around that. Issue #54
        if ((browser.ie || browser.chrome) && !composition && update &&
            update.state.doc.lines != update.startState.doc.lines)
            this.forceSelection = true;
        let prevDeco = this.decorations, deco = this.updateDeco();
        let decoDiff = findChangedDeco(prevDeco, deco, update.changes);
        changedRanges = ChangedRange.extendWithRanges(changedRanges, decoDiff);
        if (!(this.flags & 7 /* ViewFlag.Dirty */) && changedRanges.length == 0) {
            return false;
        }
        else {
            this.updateInner(changedRanges, update.startState.doc.length, composition);
            if (update.transactions.length)
                this.lastUpdate = Date.now();
            return true;
        }
    }
    // Used by update and the constructor do perform the actual DOM
    // update
    updateInner(changes, oldLength, composition) {
        this.view.viewState.mustMeasureContent = true;
        this.updateChildren(changes, oldLength, composition);
        let { observer } = this.view;
        observer.ignore(() => {
            // Lock the height during redrawing, since Chrome sometimes
            // messes with the scroll position during DOM mutation (though
            // no relayout is triggered and I cannot imagine how it can
            // recompute the scroll position without a layout)
            this.dom.style.height = this.view.viewState.contentHeight / this.view.scaleY + "px";
            this.dom.style.flexBasis = this.minWidth ? this.minWidth + "px" : "";
            // Chrome will sometimes, when DOM mutations occur directly
            // around the selection, get confused and report a different
            // selection from the one it displays (issue #218). This tries
            // to detect that situation.
            let track = browser.chrome || browser.ios ? { node: observer.selectionRange.focusNode, written: false } : undefined;
            this.sync(this.view, track);
            this.flags &= ~7 /* ViewFlag.Dirty */;
            if (track && (track.written || observer.selectionRange.focusNode != track.node))
                this.forceSelection = true;
            this.dom.style.height = "";
        });
        this.markedForComposition.forEach(cView => cView.flags &= ~8 /* ViewFlag.Composition */);
        let gaps = [];
        if (this.view.viewport.from || this.view.viewport.to < this.view.state.doc.length)
            for (let child of this.children)
                if (child instanceof BlockWidgetView && child.widget instanceof BlockGapWidget)
                    gaps.push(child.dom);
        observer.updateGaps(gaps);
    }
    updateChildren(changes, oldLength, composition) {
        let ranges = composition ? composition.range.addToSet(changes.slice()) : changes;
        let cursor = this.childCursor(oldLength);
        for (let i = ranges.length - 1;; i--) {
            let next = i >= 0 ? ranges[i] : null;
            if (!next)
                break;
            let { fromA, toA, fromB, toB } = next, content, breakAtStart, openStart, openEnd;
            if (composition && composition.range.fromB < toB && composition.range.toB > fromB) {
                let before = ContentBuilder.build(this.view.state.doc, fromB, composition.range.fromB, this.decorations, this.dynamicDecorationMap);
                let after = ContentBuilder.build(this.view.state.doc, composition.range.toB, toB, this.decorations, this.dynamicDecorationMap);
                breakAtStart = before.breakAtStart;
                openStart = before.openStart;
                openEnd = after.openEnd;
                let compLine = this.compositionView(composition);
                if (after.breakAtStart) {
                    compLine.breakAfter = 1;
                }
                else if (after.content.length &&
                    compLine.merge(compLine.length, compLine.length, after.content[0], false, after.openStart, 0)) {
                    compLine.breakAfter = after.content[0].breakAfter;
                    after.content.shift();
                }
                if (before.content.length &&
                    compLine.merge(0, 0, before.content[before.content.length - 1], true, 0, before.openEnd)) {
                    before.content.pop();
                }
                content = before.content.concat(compLine).concat(after.content);
            }
            else {
                ({ content, breakAtStart, openStart, openEnd } =
                    ContentBuilder.build(this.view.state.doc, fromB, toB, this.decorations, this.dynamicDecorationMap));
            }
            let { i: toI, off: toOff } = cursor.findPos(toA, 1);
            let { i: fromI, off: fromOff } = cursor.findPos(fromA, -1);
            replaceRange(this, fromI, fromOff, toI, toOff, content, breakAtStart, openStart, openEnd);
        }
        if (composition)
            this.fixCompositionDOM(composition);
    }
    updateEditContextFormatting(update) {
        this.editContextFormatting = this.editContextFormatting.map(update.changes);
        for (let tr of update.transactions)
            for (let effect of tr.effects)
                if (effect.is(setEditContextFormatting)) {
                    this.editContextFormatting = effect.value;
                }
    }
    compositionView(composition) {
        let cur = new TextView(composition.text.nodeValue);
        cur.flags |= 8 /* ViewFlag.Composition */;
        for (let { deco } of composition.marks)
            cur = new MarkView(deco, [cur], cur.length);
        let line = new LineView;
        line.append(cur, 0);
        return line;
    }
    fixCompositionDOM(composition) {
        let fix = (dom, cView) => {
            cView.flags |= 8 /* ViewFlag.Composition */ | (cView.children.some(c => c.flags & 7 /* ViewFlag.Dirty */) ? 1 /* ViewFlag.ChildDirty */ : 0);
            this.markedForComposition.add(cView);
            let prev = ContentView.get(dom);
            if (prev && prev != cView)
                prev.dom = null;
            cView.setDOM(dom);
        };
        let pos = this.childPos(composition.range.fromB, 1);
        let cView = this.children[pos.i];
        fix(composition.line, cView);
        for (let i = composition.marks.length - 1; i >= -1; i--) {
            pos = cView.childPos(pos.off, 1);
            cView = cView.children[pos.i];
            fix(i >= 0 ? composition.marks[i].node : composition.text, cView);
        }
    }
    // Sync the DOM selection to this.state.selection
    updateSelection(mustRead = false, fromPointer = false) {
        if (mustRead || !this.view.observer.selectionRange.focusNode)
            this.view.observer.readSelectionRange();
        let activeElt = this.view.root.activeElement, focused = activeElt == this.dom;
        let selectionNotFocus = !focused &&
            hasSelection(this.dom, this.view.observer.selectionRange) && !(activeElt && this.dom.contains(activeElt));
        if (!(focused || fromPointer || selectionNotFocus))
            return;
        let force = this.forceSelection;
        this.forceSelection = false;
        let main = this.view.state.selection.main;
        let anchor = this.moveToLine(this.domAtPos(main.anchor));
        let head = main.empty ? anchor : this.moveToLine(this.domAtPos(main.head));
        // Always reset on Firefox when next to an uneditable node to
        // avoid invisible cursor bugs (#111)
        if (browser.gecko && main.empty && !this.hasComposition && betweenUneditable(anchor)) {
            let dummy = document.createTextNode("");
            this.view.observer.ignore(() => anchor.node.insertBefore(dummy, anchor.node.childNodes[anchor.offset] || null));
            anchor = head = new DOMPos(dummy, 0);
            force = true;
        }
        let domSel = this.view.observer.selectionRange;
        // If the selection is already here, or in an equivalent position, don't touch it
        if (force || !domSel.focusNode || (!isEquivalentPosition(anchor.node, anchor.offset, domSel.anchorNode, domSel.anchorOffset) ||
            !isEquivalentPosition(head.node, head.offset, domSel.focusNode, domSel.focusOffset)) && !this.suppressWidgetCursorChange(domSel, main)) {
            this.view.observer.ignore(() => {
                // Chrome Android will hide the virtual keyboard when tapping
                // inside an uneditable node, and not bring it back when we
                // move the cursor to its proper position. This tries to
                // restore the keyboard by cycling focus.
                if (browser.android && browser.chrome && this.dom.contains(domSel.focusNode) &&
                    inUneditable(domSel.focusNode, this.dom)) {
                    this.dom.blur();
                    this.dom.focus({ preventScroll: true });
                }
                let rawSel = getSelection(this.view.root);
                if (!rawSel) ;
                else if (main.empty) {
                    // Work around https://bugzilla.mozilla.org/show_bug.cgi?id=1612076
                    if (browser.gecko) {
                        let nextTo = nextToUneditable(anchor.node, anchor.offset);
                        if (nextTo && nextTo != (1 /* NextTo.Before */ | 2 /* NextTo.After */)) {
                            let text = (nextTo == 1 /* NextTo.Before */ ? textNodeBefore : textNodeAfter)(anchor.node, anchor.offset);
                            if (text)
                                anchor = new DOMPos(text.node, text.offset);
                        }
                    }
                    rawSel.collapse(anchor.node, anchor.offset);
                    if (main.bidiLevel != null && rawSel.caretBidiLevel !== undefined)
                        rawSel.caretBidiLevel = main.bidiLevel;
                }
                else if (rawSel.extend) {
                    // Selection.extend can be used to create an 'inverted' selection
                    // (one where the focus is before the anchor), but not all
                    // browsers support it yet.
                    rawSel.collapse(anchor.node, anchor.offset);
                    // Safari will ignore the call above when the editor is
                    // hidden, and then raise an error on the call to extend
                    // (#940).
                    try {
                        rawSel.extend(head.node, head.offset);
                    }
                    catch (_) { }
                }
                else {
                    // Primitive (IE) way
                    let range = document.createRange();
                    if (main.anchor > main.head)
                        [anchor, head] = [head, anchor];
                    range.setEnd(head.node, head.offset);
                    range.setStart(anchor.node, anchor.offset);
                    rawSel.removeAllRanges();
                    rawSel.addRange(range);
                }
                if (selectionNotFocus && this.view.root.activeElement == this.dom) {
                    this.dom.blur();
                    if (activeElt)
                        activeElt.focus();
                }
            });
            this.view.observer.setSelectionRange(anchor, head);
        }
        this.impreciseAnchor = anchor.precise ? null : new DOMPos(domSel.anchorNode, domSel.anchorOffset);
        this.impreciseHead = head.precise ? null : new DOMPos(domSel.focusNode, domSel.focusOffset);
    }
    // If a zero-length widget is inserted next to the cursor during
    // composition, avoid moving it across it and disrupting the
    // composition.
    suppressWidgetCursorChange(sel, cursor) {
        return this.hasComposition && cursor.empty &&
            isEquivalentPosition(sel.focusNode, sel.focusOffset, sel.anchorNode, sel.anchorOffset) &&
            this.posFromDOM(sel.focusNode, sel.focusOffset) == cursor.head;
    }
    enforceCursorAssoc() {
        if (this.hasComposition)
            return;
        let { view } = this, cursor = view.state.selection.main;
        let sel = getSelection(view.root);
        let { anchorNode, anchorOffset } = view.observer.selectionRange;
        if (!sel || !cursor.empty || !cursor.assoc || !sel.modify)
            return;
        let line = LineView.find(this, cursor.head);
        if (!line)
            return;
        let lineStart = line.posAtStart;
        if (cursor.head == lineStart || cursor.head == lineStart + line.length)
            return;
        let before = this.coordsAt(cursor.head, -1), after = this.coordsAt(cursor.head, 1);
        if (!before || !after || before.bottom > after.top)
            return;
        let dom = this.domAtPos(cursor.head + cursor.assoc);
        sel.collapse(dom.node, dom.offset);
        sel.modify("move", cursor.assoc < 0 ? "forward" : "backward", "lineboundary");
        // This can go wrong in corner cases like single-character lines,
        // so check and reset if necessary.
        view.observer.readSelectionRange();
        let newRange = view.observer.selectionRange;
        if (view.docView.posFromDOM(newRange.anchorNode, newRange.anchorOffset) != cursor.from)
            sel.collapse(anchorNode, anchorOffset);
    }
    // If a position is in/near a block widget, move it to a nearby text
    // line, since we don't want the cursor inside a block widget.
    moveToLine(pos) {
        // Block widgets will return positions before/after them, which
        // are thus directly in the document DOM element.
        let dom = this.dom, newPos;
        if (pos.node != dom)
            return pos;
        for (let i = pos.offset; !newPos && i < dom.childNodes.length; i++) {
            let view = ContentView.get(dom.childNodes[i]);
            if (view instanceof LineView)
                newPos = view.domAtPos(0);
        }
        for (let i = pos.offset - 1; !newPos && i >= 0; i--) {
            let view = ContentView.get(dom.childNodes[i]);
            if (view instanceof LineView)
                newPos = view.domAtPos(view.length);
        }
        return newPos ? new DOMPos(newPos.node, newPos.offset, true) : pos;
    }
    nearest(dom) {
        for (let cur = dom; cur;) {
            let domView = ContentView.get(cur);
            if (domView && domView.rootView == this)
                return domView;
            cur = cur.parentNode;
        }
        return null;
    }
    posFromDOM(node, offset) {
        let view = this.nearest(node);
        if (!view)
            throw new RangeError("Trying to find position for a DOM position outside of the document");
        return view.localPosFromDOM(node, offset) + view.posAtStart;
    }
    domAtPos(pos) {
        let { i, off } = this.childCursor().findPos(pos, -1);
        for (; i < this.children.length - 1;) {
            let child = this.children[i];
            if (off < child.length || child instanceof LineView)
                break;
            i++;
            off = 0;
        }
        return this.children[i].domAtPos(off);
    }
    coordsAt(pos, side) {
        let best = null, bestPos = 0;
        for (let off = this.length, i = this.children.length - 1; i >= 0; i--) {
            let child = this.children[i], end = off - child.breakAfter, start = end - child.length;
            if (end < pos)
                break;
            if (start <= pos && (start < pos || child.covers(-1)) && (end > pos || child.covers(1)) &&
                (!best || child instanceof LineView && !(best instanceof LineView && side >= 0))) {
                best = child;
                bestPos = start;
            }
            else if (best && start == pos && end == pos && child instanceof BlockWidgetView && Math.abs(side) < 2) {
                if (child.deco.startSide < 0)
                    break;
                else if (i)
                    best = null;
            }
            off = start;
        }
        return best ? best.coordsAt(pos - bestPos, side) : null;
    }
    coordsForChar(pos) {
        let { i, off } = this.childPos(pos, 1), child = this.children[i];
        if (!(child instanceof LineView))
            return null;
        while (child.children.length) {
            let { i, off: childOff } = child.childPos(off, 1);
            for (;; i++) {
                if (i == child.children.length)
                    return null;
                if ((child = child.children[i]).length)
                    break;
            }
            off = childOff;
        }
        if (!(child instanceof TextView))
            return null;
        let end = findClusterBreak(child.text, off);
        if (end == off)
            return null;
        let rects = textRange(child.dom, off, end).getClientRects();
        for (let i = 0; i < rects.length; i++) {
            let rect = rects[i];
            if (i == rects.length - 1 || rect.top < rect.bottom && rect.left < rect.right)
                return rect;
        }
        return null;
    }
    measureVisibleLineHeights(viewport) {
        let result = [], { from, to } = viewport;
        let contentWidth = this.view.contentDOM.clientWidth;
        let isWider = contentWidth > Math.max(this.view.scrollDOM.clientWidth, this.minWidth) + 1;
        let widest = -1, ltr = this.view.textDirection == Direction.LTR;
        for (let pos = 0, i = 0; i < this.children.length; i++) {
            let child = this.children[i], end = pos + child.length;
            if (end > to)
                break;
            if (pos >= from) {
                let childRect = child.dom.getBoundingClientRect();
                result.push(childRect.height);
                if (isWider) {
                    let last = child.dom.lastChild;
                    let rects = last ? clientRectsFor(last) : [];
                    if (rects.length) {
                        let rect = rects[rects.length - 1];
                        let width = ltr ? rect.right - childRect.left : childRect.right - rect.left;
                        if (width > widest) {
                            widest = width;
                            this.minWidth = contentWidth;
                            this.minWidthFrom = pos;
                            this.minWidthTo = end;
                        }
                    }
                }
            }
            pos = end + child.breakAfter;
        }
        return result;
    }
    textDirectionAt(pos) {
        let { i } = this.childPos(pos, 1);
        return getComputedStyle(this.children[i].dom).direction == "rtl" ? Direction.RTL : Direction.LTR;
    }
    measureTextSize() {
        for (let child of this.children) {
            if (child instanceof LineView) {
                let measure = child.measureTextSize();
                if (measure)
                    return measure;
            }
        }
        // If no workable line exists, force a layout of a measurable element
        let dummy = document.createElement("div"), lineHeight, charWidth, textHeight;
        dummy.className = "cm-line";
        dummy.style.width = "99999px";
        dummy.style.position = "absolute";
        dummy.textContent = "abc def ghi jkl mno pqr stu";
        this.view.observer.ignore(() => {
            this.dom.appendChild(dummy);
            let rect = clientRectsFor(dummy.firstChild)[0];
            lineHeight = dummy.getBoundingClientRect().height;
            charWidth = rect ? rect.width / 27 : 7;
            textHeight = rect ? rect.height : lineHeight;
            dummy.remove();
        });
        return { lineHeight, charWidth, textHeight };
    }
    childCursor(pos = this.length) {
        // Move back to start of last element when possible, so that
        // `ChildCursor.findPos` doesn't have to deal with the edge case
        // of being after the last element.
        let i = this.children.length;
        if (i)
            pos -= this.children[--i].length;
        return new ChildCursor(this.children, pos, i);
    }
    computeBlockGapDeco() {
        let deco = [], vs = this.view.viewState;
        for (let pos = 0, i = 0;; i++) {
            let next = i == vs.viewports.length ? null : vs.viewports[i];
            let end = next ? next.from - 1 : this.length;
            if (end > pos) {
                let height = (vs.lineBlockAt(end).bottom - vs.lineBlockAt(pos).top) / this.view.scaleY;
                deco.push(Decoration.replace({
                    widget: new BlockGapWidget(height),
                    block: true,
                    inclusive: true,
                    isBlockGap: true,
                }).range(pos, end));
            }
            if (!next)
                break;
            pos = next.to + 1;
        }
        return Decoration.set(deco);
    }
    updateDeco() {
        let i = 1;
        let allDeco = this.view.state.facet(decorations).map(d => {
            let dynamic = this.dynamicDecorationMap[i++] = typeof d == "function";
            return dynamic ? d(this.view) : d;
        });
        let dynamicOuter = false, outerDeco = this.view.state.facet(outerDecorations).map((d, i) => {
            let dynamic = typeof d == "function";
            if (dynamic)
                dynamicOuter = true;
            return dynamic ? d(this.view) : d;
        });
        if (outerDeco.length) {
            this.dynamicDecorationMap[i++] = dynamicOuter;
            allDeco.push(RangeSet.join(outerDeco));
        }
        this.decorations = [
            this.editContextFormatting,
            ...allDeco,
            this.computeBlockGapDeco(),
            this.view.viewState.lineGapDeco
        ];
        while (i < this.decorations.length)
            this.dynamicDecorationMap[i++] = false;
        return this.decorations;
    }
    scrollIntoView(target) {
        if (target.isSnapshot) {
            let ref = this.view.viewState.lineBlockAt(target.range.head);
            this.view.scrollDOM.scrollTop = ref.top - target.yMargin;
            this.view.scrollDOM.scrollLeft = target.xMargin;
            return;
        }
        for (let handler of this.view.state.facet(scrollHandler)) {
            try {
                if (handler(this.view, target.range, target))
                    return true;
            }
            catch (e) {
                logException(this.view.state, e, "scroll handler");
            }
        }
        let { range } = target;
        let rect = this.coordsAt(range.head, range.empty ? range.assoc : range.head > range.anchor ? -1 : 1), other;
        if (!rect)
            return;
        if (!range.empty && (other = this.coordsAt(range.anchor, range.anchor > range.head ? -1 : 1)))
            rect = { left: Math.min(rect.left, other.left), top: Math.min(rect.top, other.top),
                right: Math.max(rect.right, other.right), bottom: Math.max(rect.bottom, other.bottom) };
        let margins = getScrollMargins(this.view);
        let targetRect = {
            left: rect.left - margins.left, top: rect.top - margins.top,
            right: rect.right + margins.right, bottom: rect.bottom + margins.bottom
        };
        let { offsetWidth, offsetHeight } = this.view.scrollDOM;
        scrollRectIntoView(this.view.scrollDOM, targetRect, range.head < range.anchor ? -1 : 1, target.x, target.y, Math.max(Math.min(target.xMargin, offsetWidth), -offsetWidth), Math.max(Math.min(target.yMargin, offsetHeight), -offsetHeight), this.view.textDirection == Direction.LTR);
    }
}
function betweenUneditable(pos) {
    return pos.node.nodeType == 1 && pos.node.firstChild &&
        (pos.offset == 0 || pos.node.childNodes[pos.offset - 1].contentEditable == "false") &&
        (pos.offset == pos.node.childNodes.length || pos.node.childNodes[pos.offset].contentEditable == "false");
}
class BlockGapWidget extends WidgetType {
    constructor(height) {
        super();
        this.height = height;
    }
    toDOM() {
        let elt = document.createElement("div");
        elt.className = "cm-gap";
        this.updateDOM(elt);
        return elt;
    }
    eq(other) { return other.height == this.height; }
    updateDOM(elt) {
        elt.style.height = this.height + "px";
        return true;
    }
    get editable() { return true; }
    get estimatedHeight() { return this.height; }
    ignoreEvent() { return false; }
}
function findCompositionNode(view, headPos) {
    let sel = view.observer.selectionRange;
    if (!sel.focusNode)
        return null;
    let textBefore = textNodeBefore(sel.focusNode, sel.focusOffset);
    let textAfter = textNodeAfter(sel.focusNode, sel.focusOffset);
    let textNode = textBefore || textAfter;
    if (textAfter && textBefore && textAfter.node != textBefore.node) {
        let descAfter = ContentView.get(textAfter.node);
        if (!descAfter || descAfter instanceof TextView && descAfter.text != textAfter.node.nodeValue) {
            textNode = textAfter;
        }
        else if (view.docView.lastCompositionAfterCursor) {
            let descBefore = ContentView.get(textBefore.node);
            if (!(!descBefore || descBefore instanceof TextView && descBefore.text != textBefore.node.nodeValue))
                textNode = textAfter;
        }
    }
    view.docView.lastCompositionAfterCursor = textNode != textBefore;
    if (!textNode)
        return null;
    let from = headPos - textNode.offset;
    return { from, to: from + textNode.node.nodeValue.length, node: textNode.node };
}
function findCompositionRange(view, changes, headPos) {
    let found = findCompositionNode(view, headPos);
    if (!found)
        return null;
    let { node: textNode, from, to } = found, text = textNode.nodeValue;
    // Don't try to preserve multi-line compositions
    if (/[\n\r]/.test(text))
        return null;
    if (view.state.doc.sliceString(found.from, found.to) != text)
        return null;
    let inv = changes.invertedDesc;
    let range = new ChangedRange(inv.mapPos(from), inv.mapPos(to), from, to);
    let marks = [];
    for (let parent = textNode.parentNode;; parent = parent.parentNode) {
        let parentView = ContentView.get(parent);
        if (parentView instanceof MarkView)
            marks.push({ node: parent, deco: parentView.mark });
        else if (parentView instanceof LineView || parent.nodeName == "DIV" && parent.parentNode == view.contentDOM)
            return { range, text: textNode, marks, line: parent };
        else if (parent != view.contentDOM)
            marks.push({ node: parent, deco: new MarkDecoration({
                    inclusive: true,
                    attributes: getAttrs(parent),
                    tagName: parent.tagName.toLowerCase()
                }) });
        else
            return null;
    }
}
function nextToUneditable(node, offset) {
    if (node.nodeType != 1)
        return 0;
    return (offset && node.childNodes[offset - 1].contentEditable == "false" ? 1 /* NextTo.Before */ : 0) |
        (offset < node.childNodes.length && node.childNodes[offset].contentEditable == "false" ? 2 /* NextTo.After */ : 0);
}
let DecorationComparator$1 = class DecorationComparator {
    constructor() {
        this.changes = [];
    }
    compareRange(from, to) { addRange(from, to, this.changes); }
    comparePoint(from, to) { addRange(from, to, this.changes); }
};
function findChangedDeco(a, b, diff) {
    let comp = new DecorationComparator$1;
    RangeSet.compare(a, b, diff, comp);
    return comp.changes;
}
function inUneditable(node, inside) {
    for (let cur = node; cur && cur != inside; cur = cur.assignedSlot || cur.parentNode) {
        if (cur.nodeType == 1 && cur.contentEditable == 'false') {
            return true;
        }
    }
    return false;
}
function touchesComposition(changes, composition) {
    let touched = false;
    if (composition)
        changes.iterChangedRanges((from, to) => {
            if (from < composition.to && to > composition.from)
                touched = true;
        });
    return touched;
}

function groupAt(state, pos, bias = 1) {
    let categorize = state.charCategorizer(pos);
    let line = state.doc.lineAt(pos), linePos = pos - line.from;
    if (line.length == 0)
        return EditorSelection.cursor(pos);
    if (linePos == 0)
        bias = 1;
    else if (linePos == line.length)
        bias = -1;
    let from = linePos, to = linePos;
    if (bias < 0)
        from = findClusterBreak(line.text, linePos, false);
    else
        to = findClusterBreak(line.text, linePos);
    let cat = categorize(line.text.slice(from, to));
    while (from > 0) {
        let prev = findClusterBreak(line.text, from, false);
        if (categorize(line.text.slice(prev, from)) != cat)
            break;
        from = prev;
    }
    while (to < line.length) {
        let next = findClusterBreak(line.text, to);
        if (categorize(line.text.slice(to, next)) != cat)
            break;
        to = next;
    }
    return EditorSelection.range(from + line.from, to + line.from);
}
// Search the DOM for the {node, offset} position closest to the given
// coordinates. Very inefficient and crude, but can usually be avoided
// by calling caret(Position|Range)FromPoint instead.
function getdx(x, rect) {
    return rect.left > x ? rect.left - x : Math.max(0, x - rect.right);
}
function getdy(y, rect) {
    return rect.top > y ? rect.top - y : Math.max(0, y - rect.bottom);
}
function yOverlap(a, b) {
    return a.top < b.bottom - 1 && a.bottom > b.top + 1;
}
function upTop(rect, top) {
    return top < rect.top ? { top, left: rect.left, right: rect.right, bottom: rect.bottom } : rect;
}
function upBot(rect, bottom) {
    return bottom > rect.bottom ? { top: rect.top, left: rect.left, right: rect.right, bottom } : rect;
}
function domPosAtCoords(parent, x, y) {
    let closest, closestRect, closestX, closestY, closestOverlap = false;
    let above, below, aboveRect, belowRect;
    for (let child = parent.firstChild; child; child = child.nextSibling) {
        let rects = clientRectsFor(child);
        for (let i = 0; i < rects.length; i++) {
            let rect = rects[i];
            if (closestRect && yOverlap(closestRect, rect))
                rect = upTop(upBot(rect, closestRect.bottom), closestRect.top);
            let dx = getdx(x, rect), dy = getdy(y, rect);
            if (dx == 0 && dy == 0)
                return child.nodeType == 3 ? domPosInText(child, x, y) : domPosAtCoords(child, x, y);
            if (!closest || closestY > dy || closestY == dy && closestX > dx) {
                closest = child;
                closestRect = rect;
                closestX = dx;
                closestY = dy;
                let side = dy ? (y < rect.top ? -1 : 1) : dx ? (x < rect.left ? -1 : 1) : 0;
                closestOverlap = !side || (side > 0 ? i < rects.length - 1 : i > 0);
            }
            if (dx == 0) {
                if (y > rect.bottom && (!aboveRect || aboveRect.bottom < rect.bottom)) {
                    above = child;
                    aboveRect = rect;
                }
                else if (y < rect.top && (!belowRect || belowRect.top > rect.top)) {
                    below = child;
                    belowRect = rect;
                }
            }
            else if (aboveRect && yOverlap(aboveRect, rect)) {
                aboveRect = upBot(aboveRect, rect.bottom);
            }
            else if (belowRect && yOverlap(belowRect, rect)) {
                belowRect = upTop(belowRect, rect.top);
            }
        }
    }
    if (aboveRect && aboveRect.bottom >= y) {
        closest = above;
        closestRect = aboveRect;
    }
    else if (belowRect && belowRect.top <= y) {
        closest = below;
        closestRect = belowRect;
    }
    if (!closest)
        return { node: parent, offset: 0 };
    let clipX = Math.max(closestRect.left, Math.min(closestRect.right, x));
    if (closest.nodeType == 3)
        return domPosInText(closest, clipX, y);
    if (closestOverlap && closest.contentEditable != "false")
        return domPosAtCoords(closest, clipX, y);
    let offset = Array.prototype.indexOf.call(parent.childNodes, closest) +
        (x >= (closestRect.left + closestRect.right) / 2 ? 1 : 0);
    return { node: parent, offset };
}
function domPosInText(node, x, y) {
    let len = node.nodeValue.length;
    let closestOffset = -1, closestDY = 1e9, generalSide = 0;
    for (let i = 0; i < len; i++) {
        let rects = textRange(node, i, i + 1).getClientRects();
        for (let j = 0; j < rects.length; j++) {
            let rect = rects[j];
            if (rect.top == rect.bottom)
                continue;
            if (!generalSide)
                generalSide = x - rect.left;
            let dy = (rect.top > y ? rect.top - y : y - rect.bottom) - 1;
            if (rect.left - 1 <= x && rect.right + 1 >= x && dy < closestDY) {
                let right = x >= (rect.left + rect.right) / 2, after = right;
                if (browser.chrome || browser.gecko) {
                    // Check for RTL on browsers that support getting client
                    // rects for empty ranges.
                    let rectBefore = textRange(node, i).getBoundingClientRect();
                    if (rectBefore.left == rect.right)
                        after = !right;
                }
                if (dy <= 0)
                    return { node, offset: i + (after ? 1 : 0) };
                closestOffset = i + (after ? 1 : 0);
                closestDY = dy;
            }
        }
    }
    return { node, offset: closestOffset > -1 ? closestOffset : generalSide > 0 ? node.nodeValue.length : 0 };
}
function posAtCoords(view, coords, precise, bias = -1) {
    var _a, _b;
    let content = view.contentDOM.getBoundingClientRect(), docTop = content.top + view.viewState.paddingTop;
    let block, { docHeight } = view.viewState;
    let { x, y } = coords, yOffset = y - docTop;
    if (yOffset < 0)
        return 0;
    if (yOffset > docHeight)
        return view.state.doc.length;
    // Scan for a text block near the queried y position
    for (let halfLine = view.viewState.heightOracle.textHeight / 2, bounced = false;;) {
        block = view.elementAtHeight(yOffset);
        if (block.type == BlockType.Text)
            break;
        for (;;) {
            // Move the y position out of this block
            yOffset = bias > 0 ? block.bottom + halfLine : block.top - halfLine;
            if (yOffset >= 0 && yOffset <= docHeight)
                break;
            // If the document consists entirely of replaced widgets, we
            // won't find a text block, so return 0
            if (bounced)
                return precise ? null : 0;
            bounced = true;
            bias = -bias;
        }
    }
    y = docTop + yOffset;
    let lineStart = block.from;
    // If this is outside of the rendered viewport, we can't determine a position
    if (lineStart < view.viewport.from)
        return view.viewport.from == 0 ? 0 : precise ? null : posAtCoordsImprecise(view, content, block, x, y);
    if (lineStart > view.viewport.to)
        return view.viewport.to == view.state.doc.length ? view.state.doc.length :
            precise ? null : posAtCoordsImprecise(view, content, block, x, y);
    // Prefer ShadowRootOrDocument.elementFromPoint if present, fall back to document if not
    let doc = view.dom.ownerDocument;
    let root = view.root.elementFromPoint ? view.root : doc;
    let element = root.elementFromPoint(x, y);
    if (element && !view.contentDOM.contains(element))
        element = null;
    // If the element is unexpected, clip x at the sides of the content area and try again
    if (!element) {
        x = Math.max(content.left + 1, Math.min(content.right - 1, x));
        element = root.elementFromPoint(x, y);
        if (element && !view.contentDOM.contains(element))
            element = null;
    }
    // There's visible editor content under the point, so we can try
    // using caret(Position|Range)FromPoint as a shortcut
    let node, offset = -1;
    if (element && ((_a = view.docView.nearest(element)) === null || _a === void 0 ? void 0 : _a.isEditable) != false) {
        if (doc.caretPositionFromPoint) {
            let pos = doc.caretPositionFromPoint(x, y);
            if (pos)
                ({ offsetNode: node, offset } = pos);
        }
        else if (doc.caretRangeFromPoint) {
            let range = doc.caretRangeFromPoint(x, y);
            if (range) {
                ({ startContainer: node, startOffset: offset } = range);
                if (!view.contentDOM.contains(node) ||
                    browser.safari && isSuspiciousSafariCaretResult(node, offset, x) ||
                    browser.chrome && isSuspiciousChromeCaretResult(node, offset, x))
                    node = undefined;
            }
        }
    }
    // No luck, do our own (potentially expensive) search
    if (!node || !view.docView.dom.contains(node)) {
        let line = LineView.find(view.docView, lineStart);
        if (!line)
            return yOffset > block.top + block.height / 2 ? block.to : block.from;
        ({ node, offset } = domPosAtCoords(line.dom, x, y));
    }
    let nearest = view.docView.nearest(node);
    if (!nearest)
        return null;
    if (nearest.isWidget && ((_b = nearest.dom) === null || _b === void 0 ? void 0 : _b.nodeType) == 1) {
        let rect = nearest.dom.getBoundingClientRect();
        return coords.y < rect.top || coords.y <= rect.bottom && coords.x <= (rect.left + rect.right) / 2
            ? nearest.posAtStart : nearest.posAtEnd;
    }
    else {
        return nearest.localPosFromDOM(node, offset) + nearest.posAtStart;
    }
}
function posAtCoordsImprecise(view, contentRect, block, x, y) {
    let into = Math.round((x - contentRect.left) * view.defaultCharacterWidth);
    if (view.lineWrapping && block.height > view.defaultLineHeight * 1.5) {
        let textHeight = view.viewState.heightOracle.textHeight;
        let line = Math.floor((y - block.top - (view.defaultLineHeight - textHeight) * 0.5) / textHeight);
        into += line * view.viewState.heightOracle.lineLength;
    }
    let content = view.state.sliceDoc(block.from, block.to);
    return block.from + findColumn(content, into, view.state.tabSize);
}
// In case of a high line height, Safari's caretRangeFromPoint treats
// the space between lines as belonging to the last character of the
// line before. This is used to detect such a result so that it can be
// ignored (issue #401).
function isSuspiciousSafariCaretResult(node, offset, x) {
    let len;
    if (node.nodeType != 3 || offset != (len = node.nodeValue.length))
        return false;
    for (let next = node.nextSibling; next; next = next.nextSibling)
        if (next.nodeType != 1 || next.nodeName != "BR")
            return false;
    return textRange(node, len - 1, len).getBoundingClientRect().left > x;
}
// Chrome will move positions between lines to the start of the next line
function isSuspiciousChromeCaretResult(node, offset, x) {
    if (offset != 0)
        return false;
    for (let cur = node;;) {
        let parent = cur.parentNode;
        if (!parent || parent.nodeType != 1 || parent.firstChild != cur)
            return false;
        if (parent.classList.contains("cm-line"))
            break;
        cur = parent;
    }
    let rect = node.nodeType == 1 ? node.getBoundingClientRect()
        : textRange(node, 0, Math.max(node.nodeValue.length, 1)).getBoundingClientRect();
    return x - rect.left > 5;
}
function blockAt(view, pos) {
    let line = view.lineBlockAt(pos);
    if (Array.isArray(line.type))
        for (let l of line.type) {
            if (l.to > pos || l.to == pos && (l.to == line.to || l.type == BlockType.Text))
                return l;
        }
    return line;
}
function moveToLineBoundary(view, start, forward, includeWrap) {
    let line = blockAt(view, start.head);
    let coords = !includeWrap || line.type != BlockType.Text || !(view.lineWrapping || line.widgetLineBreaks) ? null
        : view.coordsAtPos(start.assoc < 0 && start.head > line.from ? start.head - 1 : start.head);
    if (coords) {
        let editorRect = view.dom.getBoundingClientRect();
        let direction = view.textDirectionAt(line.from);
        let pos = view.posAtCoords({ x: forward == (direction == Direction.LTR) ? editorRect.right - 1 : editorRect.left + 1,
            y: (coords.top + coords.bottom) / 2 });
        if (pos != null)
            return EditorSelection.cursor(pos, forward ? -1 : 1);
    }
    return EditorSelection.cursor(forward ? line.to : line.from, forward ? -1 : 1);
}
function moveByChar(view, start, forward, by) {
    let line = view.state.doc.lineAt(start.head), spans = view.bidiSpans(line);
    let direction = view.textDirectionAt(line.from);
    for (let cur = start, check = null;;) {
        let next = moveVisually(line, spans, direction, cur, forward), char = movedOver;
        if (!next) {
            if (line.number == (forward ? view.state.doc.lines : 1))
                return cur;
            char = "\n";
            line = view.state.doc.line(line.number + (forward ? 1 : -1));
            spans = view.bidiSpans(line);
            next = view.visualLineSide(line, !forward);
        }
        if (!check) {
            if (!by)
                return next;
            check = by(char);
        }
        else if (!check(char)) {
            return cur;
        }
        cur = next;
    }
}
function byGroup(view, pos, start) {
    let categorize = view.state.charCategorizer(pos);
    let cat = categorize(start);
    return (next) => {
        let nextCat = categorize(next);
        if (cat == CharCategory.Space)
            cat = nextCat;
        return cat == nextCat;
    };
}
function moveVertically(view, start, forward, distance) {
    let startPos = start.head, dir = forward ? 1 : -1;
    if (startPos == (forward ? view.state.doc.length : 0))
        return EditorSelection.cursor(startPos, start.assoc);
    let goal = start.goalColumn, startY;
    let rect = view.contentDOM.getBoundingClientRect();
    let startCoords = view.coordsAtPos(startPos, start.assoc || -1), docTop = view.documentTop;
    if (startCoords) {
        if (goal == null)
            goal = startCoords.left - rect.left;
        startY = dir < 0 ? startCoords.top : startCoords.bottom;
    }
    else {
        let line = view.viewState.lineBlockAt(startPos);
        if (goal == null)
            goal = Math.min(rect.right - rect.left, view.defaultCharacterWidth * (startPos - line.from));
        startY = (dir < 0 ? line.top : line.bottom) + docTop;
    }
    let resolvedGoal = rect.left + goal;
    let dist = distance !== null && distance !== void 0 ? distance : (view.viewState.heightOracle.textHeight >> 1);
    for (let extra = 0;; extra += 10) {
        let curY = startY + (dist + extra) * dir;
        let pos = posAtCoords(view, { x: resolvedGoal, y: curY }, false, dir);
        if (curY < rect.top || curY > rect.bottom || (dir < 0 ? pos < startPos : pos > startPos)) {
            let charRect = view.docView.coordsForChar(pos);
            let assoc = !charRect || curY < charRect.top ? -1 : 1;
            return EditorSelection.cursor(pos, assoc, undefined, goal);
        }
    }
}
function skipAtomicRanges(atoms, pos, bias) {
    for (;;) {
        let moved = 0;
        for (let set of atoms) {
            set.between(pos - 1, pos + 1, (from, to, value) => {
                if (pos > from && pos < to) {
                    let side = moved || bias || (pos - from < to - pos ? -1 : 1);
                    pos = side < 0 ? from : to;
                    moved = side;
                }
            });
        }
        if (!moved)
            return pos;
    }
}
function skipAtoms(view, oldPos, pos) {
    let newPos = skipAtomicRanges(view.state.facet(atomicRanges).map(f => f(view)), pos.from, oldPos.head > pos.from ? -1 : 1);
    return newPos == pos.from ? pos : EditorSelection.cursor(newPos, newPos < pos.from ? 1 : -1);
}

// This will also be where dragging info and such goes
class InputState {
    setSelectionOrigin(origin) {
        this.lastSelectionOrigin = origin;
        this.lastSelectionTime = Date.now();
    }
    constructor(view) {
        this.view = view;
        this.lastKeyCode = 0;
        this.lastKeyTime = 0;
        this.lastTouchTime = 0;
        this.lastFocusTime = 0;
        this.lastScrollTop = 0;
        this.lastScrollLeft = 0;
        // On iOS, some keys need to have their default behavior happen
        // (after which we retroactively handle them and reset the DOM) to
        // avoid messing up the virtual keyboard state.
        this.pendingIOSKey = undefined;
        /**
        When enabled (>-1), tab presses are not given to key handlers,
        leaving the browser's default behavior. If >0, the mode expires
        at that timestamp, and any other keypress clears it.
        Esc enables temporary tab focus mode for two seconds when not
        otherwise handled.
        */
        this.tabFocusMode = -1;
        this.lastSelectionOrigin = null;
        this.lastSelectionTime = 0;
        this.lastContextMenu = 0;
        this.scrollHandlers = [];
        this.handlers = Object.create(null);
        // -1 means not in a composition. Otherwise, this counts the number
        // of changes made during the composition. The count is used to
        // avoid treating the start state of the composition, before any
        // changes have been made, as part of the composition.
        this.composing = -1;
        // Tracks whether the next change should be marked as starting the
        // composition (null means no composition, true means next is the
        // first, false means first has already been marked for this
        // composition)
        this.compositionFirstChange = null;
        // End time of the previous composition
        this.compositionEndedAt = 0;
        // Used in a kludge to detect when an Enter keypress should be
        // considered part of the composition on Safari, which fires events
        // in the wrong order
        this.compositionPendingKey = false;
        // Used to categorize changes as part of a composition, even when
        // the mutation events fire shortly after the compositionend event
        this.compositionPendingChange = false;
        this.mouseSelection = null;
        // When a drag from the editor is active, this points at the range
        // being dragged.
        this.draggedContent = null;
        this.handleEvent = this.handleEvent.bind(this);
        this.notifiedFocused = view.hasFocus;
        // On Safari adding an input event handler somehow prevents an
        // issue where the composition vanishes when you press enter.
        if (browser.safari)
            view.contentDOM.addEventListener("input", () => null);
        if (browser.gecko)
            firefoxCopyCutHack(view.contentDOM.ownerDocument);
    }
    handleEvent(event) {
        if (!eventBelongsToEditor(this.view, event) || this.ignoreDuringComposition(event))
            return;
        if (event.type == "keydown" && this.keydown(event))
            return;
        this.runHandlers(event.type, event);
    }
    runHandlers(type, event) {
        let handlers = this.handlers[type];
        if (handlers) {
            for (let observer of handlers.observers)
                observer(this.view, event);
            for (let handler of handlers.handlers) {
                if (event.defaultPrevented)
                    break;
                if (handler(this.view, event)) {
                    event.preventDefault();
                    break;
                }
            }
        }
    }
    ensureHandlers(plugins) {
        let handlers = computeHandlers(plugins), prev = this.handlers, dom = this.view.contentDOM;
        for (let type in handlers)
            if (type != "scroll") {
                let passive = !handlers[type].handlers.length;
                let exists = prev[type];
                if (exists && passive != !exists.handlers.length) {
                    dom.removeEventListener(type, this.handleEvent);
                    exists = null;
                }
                if (!exists)
                    dom.addEventListener(type, this.handleEvent, { passive });
            }
        for (let type in prev)
            if (type != "scroll" && !handlers[type])
                dom.removeEventListener(type, this.handleEvent);
        this.handlers = handlers;
    }
    keydown(event) {
        // Must always run, even if a custom handler handled the event
        this.lastKeyCode = event.keyCode;
        this.lastKeyTime = Date.now();
        if (event.keyCode == 9 && this.tabFocusMode > -1 && (!this.tabFocusMode || Date.now() <= this.tabFocusMode))
            return true;
        if (this.tabFocusMode > 0 && event.keyCode != 27 && modifierCodes.indexOf(event.keyCode) < 0)
            this.tabFocusMode = -1;
        // Chrome for Android usually doesn't fire proper key events, but
        // occasionally does, usually surrounded by a bunch of complicated
        // composition changes. When an enter or backspace key event is
        // seen, hold off on handling DOM events for a bit, and then
        // dispatch it.
        if (browser.android && browser.chrome && !event.synthetic &&
            (event.keyCode == 13 || event.keyCode == 8)) {
            this.view.observer.delayAndroidKey(event.key, event.keyCode);
            return true;
        }
        // Preventing the default behavior of Enter on iOS makes the
        // virtual keyboard get stuck in the wrong (lowercase)
        // state. So we let it go through, and then, in
        // applyDOMChange, notify key handlers of it and reset to
        // the state they produce.
        let pending;
        if (browser.ios && !event.synthetic && !event.altKey && !event.metaKey &&
            ((pending = PendingKeys.find(key => key.keyCode == event.keyCode)) && !event.ctrlKey ||
                EmacsyPendingKeys.indexOf(event.key) > -1 && event.ctrlKey && !event.shiftKey)) {
            this.pendingIOSKey = pending || event;
            setTimeout(() => this.flushIOSKey(), 250);
            return true;
        }
        if (event.keyCode != 229)
            this.view.observer.forceFlush();
        return false;
    }
    flushIOSKey(change) {
        let key = this.pendingIOSKey;
        if (!key)
            return false;
        // This looks like an autocorrection before Enter
        if (key.key == "Enter" && change && change.from < change.to && /^\S+$/.test(change.insert.toString()))
            return false;
        this.pendingIOSKey = undefined;
        return dispatchKey(this.view.contentDOM, key.key, key.keyCode, key instanceof KeyboardEvent ? key : undefined);
    }
    ignoreDuringComposition(event) {
        if (!/^key/.test(event.type))
            return false;
        if (this.composing > 0)
            return true;
        // See https://www.stum.de/2016/06/24/handling-ime-events-in-javascript/.
        // On some input method editors (IMEs), the Enter key is used to
        // confirm character selection. On Safari, when Enter is pressed,
        // compositionend and keydown events are sometimes emitted in the
        // wrong order. The key event should still be ignored, even when
        // it happens after the compositionend event.
        if (browser.safari && !browser.ios && this.compositionPendingKey && Date.now() - this.compositionEndedAt < 100) {
            this.compositionPendingKey = false;
            return true;
        }
        return false;
    }
    startMouseSelection(mouseSelection) {
        if (this.mouseSelection)
            this.mouseSelection.destroy();
        this.mouseSelection = mouseSelection;
    }
    update(update) {
        this.view.observer.update(update);
        if (this.mouseSelection)
            this.mouseSelection.update(update);
        if (this.draggedContent && update.docChanged)
            this.draggedContent = this.draggedContent.map(update.changes);
        if (update.transactions.length)
            this.lastKeyCode = this.lastSelectionTime = 0;
    }
    destroy() {
        if (this.mouseSelection)
            this.mouseSelection.destroy();
    }
}
function bindHandler(plugin, handler) {
    return (view, event) => {
        try {
            return handler.call(plugin, event, view);
        }
        catch (e) {
            logException(view.state, e);
        }
    };
}
function computeHandlers(plugins) {
    let result = Object.create(null);
    function record(type) {
        return result[type] || (result[type] = { observers: [], handlers: [] });
    }
    for (let plugin of plugins) {
        let spec = plugin.spec;
        if (spec && spec.domEventHandlers)
            for (let type in spec.domEventHandlers) {
                let f = spec.domEventHandlers[type];
                if (f)
                    record(type).handlers.push(bindHandler(plugin.value, f));
            }
        if (spec && spec.domEventObservers)
            for (let type in spec.domEventObservers) {
                let f = spec.domEventObservers[type];
                if (f)
                    record(type).observers.push(bindHandler(plugin.value, f));
            }
    }
    for (let type in handlers)
        record(type).handlers.push(handlers[type]);
    for (let type in observers)
        record(type).observers.push(observers[type]);
    return result;
}
const PendingKeys = [
    { key: "Backspace", keyCode: 8, inputType: "deleteContentBackward" },
    { key: "Enter", keyCode: 13, inputType: "insertParagraph" },
    { key: "Enter", keyCode: 13, inputType: "insertLineBreak" },
    { key: "Delete", keyCode: 46, inputType: "deleteContentForward" }
];
const EmacsyPendingKeys = "dthko";
// Key codes for modifier keys
const modifierCodes = [16, 17, 18, 20, 91, 92, 224, 225];
const dragScrollMargin = 6;
function dragScrollSpeed(dist) {
    return Math.max(0, dist) * 0.7 + 8;
}
function dist(a, b) {
    return Math.max(Math.abs(a.clientX - b.clientX), Math.abs(a.clientY - b.clientY));
}
class MouseSelection {
    constructor(view, startEvent, style, mustSelect) {
        this.view = view;
        this.startEvent = startEvent;
        this.style = style;
        this.mustSelect = mustSelect;
        this.scrollSpeed = { x: 0, y: 0 };
        this.scrolling = -1;
        this.lastEvent = startEvent;
        this.scrollParents = scrollableParents(view.contentDOM);
        this.atoms = view.state.facet(atomicRanges).map(f => f(view));
        let doc = view.contentDOM.ownerDocument;
        doc.addEventListener("mousemove", this.move = this.move.bind(this));
        doc.addEventListener("mouseup", this.up = this.up.bind(this));
        this.extend = startEvent.shiftKey;
        this.multiple = view.state.facet(EditorState.allowMultipleSelections) && addsSelectionRange(view, startEvent);
        this.dragging = isInPrimarySelection(view, startEvent) && getClickType(startEvent) == 1 ? null : false;
    }
    start(event) {
        // When clicking outside of the selection, immediately apply the
        // effect of starting the selection
        if (this.dragging === false)
            this.select(event);
    }
    move(event) {
        if (event.buttons == 0)
            return this.destroy();
        if (this.dragging || this.dragging == null && dist(this.startEvent, event) < 10)
            return;
        this.select(this.lastEvent = event);
        let sx = 0, sy = 0;
        let left = 0, top = 0, right = this.view.win.innerWidth, bottom = this.view.win.innerHeight;
        if (this.scrollParents.x)
            ({ left, right } = this.scrollParents.x.getBoundingClientRect());
        if (this.scrollParents.y)
            ({ top, bottom } = this.scrollParents.y.getBoundingClientRect());
        let margins = getScrollMargins(this.view);
        if (event.clientX - margins.left <= left + dragScrollMargin)
            sx = -dragScrollSpeed(left - event.clientX);
        else if (event.clientX + margins.right >= right - dragScrollMargin)
            sx = dragScrollSpeed(event.clientX - right);
        if (event.clientY - margins.top <= top + dragScrollMargin)
            sy = -dragScrollSpeed(top - event.clientY);
        else if (event.clientY + margins.bottom >= bottom - dragScrollMargin)
            sy = dragScrollSpeed(event.clientY - bottom);
        this.setScrollSpeed(sx, sy);
    }
    up(event) {
        if (this.dragging == null)
            this.select(this.lastEvent);
        if (!this.dragging)
            event.preventDefault();
        this.destroy();
    }
    destroy() {
        this.setScrollSpeed(0, 0);
        let doc = this.view.contentDOM.ownerDocument;
        doc.removeEventListener("mousemove", this.move);
        doc.removeEventListener("mouseup", this.up);
        this.view.inputState.mouseSelection = this.view.inputState.draggedContent = null;
    }
    setScrollSpeed(sx, sy) {
        this.scrollSpeed = { x: sx, y: sy };
        if (sx || sy) {
            if (this.scrolling < 0)
                this.scrolling = setInterval(() => this.scroll(), 50);
        }
        else if (this.scrolling > -1) {
            clearInterval(this.scrolling);
            this.scrolling = -1;
        }
    }
    scroll() {
        let { x, y } = this.scrollSpeed;
        if (x && this.scrollParents.x) {
            this.scrollParents.x.scrollLeft += x;
            x = 0;
        }
        if (y && this.scrollParents.y) {
            this.scrollParents.y.scrollTop += y;
            y = 0;
        }
        if (x || y)
            this.view.win.scrollBy(x, y);
        if (this.dragging === false)
            this.select(this.lastEvent);
    }
    skipAtoms(sel) {
        let ranges = null;
        for (let i = 0; i < sel.ranges.length; i++) {
            let range = sel.ranges[i], updated = null;
            if (range.empty) {
                let pos = skipAtomicRanges(this.atoms, range.from, 0);
                if (pos != range.from)
                    updated = EditorSelection.cursor(pos, -1);
            }
            else {
                let from = skipAtomicRanges(this.atoms, range.from, -1);
                let to = skipAtomicRanges(this.atoms, range.to, 1);
                if (from != range.from || to != range.to)
                    updated = EditorSelection.range(range.from == range.anchor ? from : to, range.from == range.head ? from : to);
            }
            if (updated) {
                if (!ranges)
                    ranges = sel.ranges.slice();
                ranges[i] = updated;
            }
        }
        return ranges ? EditorSelection.create(ranges, sel.mainIndex) : sel;
    }
    select(event) {
        let { view } = this, selection = this.skipAtoms(this.style.get(event, this.extend, this.multiple));
        if (this.mustSelect || !selection.eq(view.state.selection, this.dragging === false))
            this.view.dispatch({
                selection,
                userEvent: "select.pointer"
            });
        this.mustSelect = false;
    }
    update(update) {
        if (update.transactions.some(tr => tr.isUserEvent("input.type")))
            this.destroy();
        else if (this.style.update(update))
            setTimeout(() => this.select(this.lastEvent), 20);
    }
}
function addsSelectionRange(view, event) {
    let facet = view.state.facet(clickAddsSelectionRange);
    return facet.length ? facet[0](event) : browser.mac ? event.metaKey : event.ctrlKey;
}
function dragMovesSelection(view, event) {
    let facet = view.state.facet(dragMovesSelection$1);
    return facet.length ? facet[0](event) : browser.mac ? !event.altKey : !event.ctrlKey;
}
function isInPrimarySelection(view, event) {
    let { main } = view.state.selection;
    if (main.empty)
        return false;
    // On boundary clicks, check whether the coordinates are inside the
    // selection's client rectangles
    let sel = getSelection(view.root);
    if (!sel || sel.rangeCount == 0)
        return true;
    let rects = sel.getRangeAt(0).getClientRects();
    for (let i = 0; i < rects.length; i++) {
        let rect = rects[i];
        if (rect.left <= event.clientX && rect.right >= event.clientX &&
            rect.top <= event.clientY && rect.bottom >= event.clientY)
            return true;
    }
    return false;
}
function eventBelongsToEditor(view, event) {
    if (!event.bubbles)
        return true;
    if (event.defaultPrevented)
        return false;
    for (let node = event.target, cView; node != view.contentDOM; node = node.parentNode)
        if (!node || node.nodeType == 11 || ((cView = ContentView.get(node)) && cView.ignoreEvent(event)))
            return false;
    return true;
}
const handlers = /*@__PURE__*/Object.create(null);
const observers = /*@__PURE__*/Object.create(null);
// This is very crude, but unfortunately both these browsers _pretend_
// that they have a clipboard API—all the objects and methods are
// there, they just don't work, and they are hard to test.
const brokenClipboardAPI = (browser.ie && browser.ie_version < 15) ||
    (browser.ios && browser.webkit_version < 604);
function capturePaste(view) {
    let parent = view.dom.parentNode;
    if (!parent)
        return;
    let target = parent.appendChild(document.createElement("textarea"));
    target.style.cssText = "position: fixed; left: -10000px; top: 10px";
    target.focus();
    setTimeout(() => {
        view.focus();
        target.remove();
        doPaste(view, target.value);
    }, 50);
}
function doPaste(view, input) {
    let { state } = view, changes, i = 1, text = state.toText(input);
    let byLine = text.lines == state.selection.ranges.length;
    let linewise = lastLinewiseCopy != null && state.selection.ranges.every(r => r.empty) && lastLinewiseCopy == text.toString();
    if (linewise) {
        let lastLine = -1;
        changes = state.changeByRange(range => {
            let line = state.doc.lineAt(range.from);
            if (line.from == lastLine)
                return { range };
            lastLine = line.from;
            let insert = state.toText((byLine ? text.line(i++).text : input) + state.lineBreak);
            return { changes: { from: line.from, insert },
                range: EditorSelection.cursor(range.from + insert.length) };
        });
    }
    else if (byLine) {
        changes = state.changeByRange(range => {
            let line = text.line(i++);
            return { changes: { from: range.from, to: range.to, insert: line.text },
                range: EditorSelection.cursor(range.from + line.length) };
        });
    }
    else {
        changes = state.replaceSelection(text);
    }
    view.dispatch(changes, {
        userEvent: "input.paste",
        scrollIntoView: true
    });
}
observers.scroll = view => {
    view.inputState.lastScrollTop = view.scrollDOM.scrollTop;
    view.inputState.lastScrollLeft = view.scrollDOM.scrollLeft;
};
handlers.keydown = (view, event) => {
    view.inputState.setSelectionOrigin("select");
    if (event.keyCode == 27 && view.inputState.tabFocusMode != 0)
        view.inputState.tabFocusMode = Date.now() + 2000;
    return false;
};
observers.touchstart = (view, e) => {
    view.inputState.lastTouchTime = Date.now();
    view.inputState.setSelectionOrigin("select.pointer");
};
observers.touchmove = view => {
    view.inputState.setSelectionOrigin("select.pointer");
};
handlers.mousedown = (view, event) => {
    view.observer.flush();
    if (view.inputState.lastTouchTime > Date.now() - 2000)
        return false; // Ignore touch interaction
    let style = null;
    for (let makeStyle of view.state.facet(mouseSelectionStyle)) {
        style = makeStyle(view, event);
        if (style)
            break;
    }
    if (!style && event.button == 0)
        style = basicMouseSelection(view, event);
    if (style) {
        let mustFocus = !view.hasFocus;
        view.inputState.startMouseSelection(new MouseSelection(view, event, style, mustFocus));
        if (mustFocus)
            view.observer.ignore(() => {
                focusPreventScroll(view.contentDOM);
                let active = view.root.activeElement;
                if (active && !active.contains(view.contentDOM))
                    active.blur();
            });
        let mouseSel = view.inputState.mouseSelection;
        if (mouseSel) {
            mouseSel.start(event);
            return mouseSel.dragging === false;
        }
    }
    return false;
};
function rangeForClick(view, pos, bias, type) {
    if (type == 1) { // Single click
        return EditorSelection.cursor(pos, bias);
    }
    else if (type == 2) { // Double click
        return groupAt(view.state, pos, bias);
    }
    else { // Triple click
        let visual = LineView.find(view.docView, pos), line = view.state.doc.lineAt(visual ? visual.posAtEnd : pos);
        let from = visual ? visual.posAtStart : line.from, to = visual ? visual.posAtEnd : line.to;
        if (to < view.state.doc.length && to == line.to)
            to++;
        return EditorSelection.range(from, to);
    }
}
let insideY = (y, rect) => y >= rect.top && y <= rect.bottom;
let inside = (x, y, rect) => insideY(y, rect) && x >= rect.left && x <= rect.right;
// Try to determine, for the given coordinates, associated with the
// given position, whether they are related to the element before or
// the element after the position.
function findPositionSide(view, pos, x, y) {
    let line = LineView.find(view.docView, pos);
    if (!line)
        return 1;
    let off = pos - line.posAtStart;
    // Line boundaries point into the line
    if (off == 0)
        return 1;
    if (off == line.length)
        return -1;
    // Positions on top of an element point at that element
    let before = line.coordsAt(off, -1);
    if (before && inside(x, y, before))
        return -1;
    let after = line.coordsAt(off, 1);
    if (after && inside(x, y, after))
        return 1;
    // This is probably a line wrap point. Pick before if the point is
    // beside it.
    return before && insideY(y, before) ? -1 : 1;
}
function queryPos(view, event) {
    let pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    return { pos, bias: findPositionSide(view, pos, event.clientX, event.clientY) };
}
const BadMouseDetail = browser.ie && browser.ie_version <= 11;
let lastMouseDown = null, lastMouseDownCount = 0, lastMouseDownTime = 0;
function getClickType(event) {
    if (!BadMouseDetail)
        return event.detail;
    let last = lastMouseDown, lastTime = lastMouseDownTime;
    lastMouseDown = event;
    lastMouseDownTime = Date.now();
    return lastMouseDownCount = !last || (lastTime > Date.now() - 400 && Math.abs(last.clientX - event.clientX) < 2 &&
        Math.abs(last.clientY - event.clientY) < 2) ? (lastMouseDownCount + 1) % 3 : 1;
}
function basicMouseSelection(view, event) {
    let start = queryPos(view, event), type = getClickType(event);
    let startSel = view.state.selection;
    return {
        update(update) {
            if (update.docChanged) {
                start.pos = update.changes.mapPos(start.pos);
                startSel = startSel.map(update.changes);
            }
        },
        get(event, extend, multiple) {
            let cur = queryPos(view, event), removed;
            let range = rangeForClick(view, cur.pos, cur.bias, type);
            if (start.pos != cur.pos && !extend) {
                let startRange = rangeForClick(view, start.pos, start.bias, type);
                let from = Math.min(startRange.from, range.from), to = Math.max(startRange.to, range.to);
                range = from < range.from ? EditorSelection.range(from, to) : EditorSelection.range(to, from);
            }
            if (extend)
                return startSel.replaceRange(startSel.main.extend(range.from, range.to));
            else if (multiple && type == 1 && startSel.ranges.length > 1 && (removed = removeRangeAround(startSel, cur.pos)))
                return removed;
            else if (multiple)
                return startSel.addRange(range);
            else
                return EditorSelection.create([range]);
        }
    };
}
function removeRangeAround(sel, pos) {
    for (let i = 0; i < sel.ranges.length; i++) {
        let { from, to } = sel.ranges[i];
        if (from <= pos && to >= pos)
            return EditorSelection.create(sel.ranges.slice(0, i).concat(sel.ranges.slice(i + 1)), sel.mainIndex == i ? 0 : sel.mainIndex - (sel.mainIndex > i ? 1 : 0));
    }
    return null;
}
handlers.dragstart = (view, event) => {
    let { selection: { main: range } } = view.state;
    if (event.target.draggable) {
        let cView = view.docView.nearest(event.target);
        if (cView && cView.isWidget) {
            let from = cView.posAtStart, to = from + cView.length;
            if (from >= range.to || to <= range.from)
                range = EditorSelection.range(from, to);
        }
    }
    let { inputState } = view;
    if (inputState.mouseSelection)
        inputState.mouseSelection.dragging = true;
    inputState.draggedContent = range;
    if (event.dataTransfer) {
        event.dataTransfer.setData("Text", view.state.sliceDoc(range.from, range.to));
        event.dataTransfer.effectAllowed = "copyMove";
    }
    return false;
};
handlers.dragend = view => {
    view.inputState.draggedContent = null;
    return false;
};
function dropText(view, event, text, direct) {
    if (!text)
        return;
    let dropPos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    let { draggedContent } = view.inputState;
    let del = direct && draggedContent && dragMovesSelection(view, event)
        ? { from: draggedContent.from, to: draggedContent.to } : null;
    let ins = { from: dropPos, insert: text };
    let changes = view.state.changes(del ? [del, ins] : ins);
    view.focus();
    view.dispatch({
        changes,
        selection: { anchor: changes.mapPos(dropPos, -1), head: changes.mapPos(dropPos, 1) },
        userEvent: del ? "move.drop" : "input.drop"
    });
    view.inputState.draggedContent = null;
}
handlers.drop = (view, event) => {
    if (!event.dataTransfer)
        return false;
    if (view.state.readOnly)
        return true;
    let files = event.dataTransfer.files;
    if (files && files.length) { // For a file drop, read the file's text.
        let text = Array(files.length), read = 0;
        let finishFile = () => {
            if (++read == files.length)
                dropText(view, event, text.filter(s => s != null).join(view.state.lineBreak), false);
        };
        for (let i = 0; i < files.length; i++) {
            let reader = new FileReader;
            reader.onerror = finishFile;
            reader.onload = () => {
                if (!/[\x00-\x08\x0e-\x1f]{2}/.test(reader.result))
                    text[i] = reader.result;
                finishFile();
            };
            reader.readAsText(files[i]);
        }
        return true;
    }
    else {
        let text = event.dataTransfer.getData("Text");
        if (text) {
            dropText(view, event, text, true);
            return true;
        }
    }
    return false;
};
handlers.paste = (view, event) => {
    if (view.state.readOnly)
        return true;
    view.observer.flush();
    let data = brokenClipboardAPI ? null : event.clipboardData;
    if (data) {
        doPaste(view, data.getData("text/plain") || data.getData("text/uri-list"));
        return true;
    }
    else {
        capturePaste(view);
        return false;
    }
};
function captureCopy(view, text) {
    // The extra wrapper is somehow necessary on IE/Edge to prevent the
    // content from being mangled when it is put onto the clipboard
    let parent = view.dom.parentNode;
    if (!parent)
        return;
    let target = parent.appendChild(document.createElement("textarea"));
    target.style.cssText = "position: fixed; left: -10000px; top: 10px";
    target.value = text;
    target.focus();
    target.selectionEnd = text.length;
    target.selectionStart = 0;
    setTimeout(() => {
        target.remove();
        view.focus();
    }, 50);
}
function copiedRange(state) {
    let content = [], ranges = [], linewise = false;
    for (let range of state.selection.ranges)
        if (!range.empty) {
            content.push(state.sliceDoc(range.from, range.to));
            ranges.push(range);
        }
    if (!content.length) {
        // Nothing selected, do a line-wise copy
        let upto = -1;
        for (let { from } of state.selection.ranges) {
            let line = state.doc.lineAt(from);
            if (line.number > upto) {
                content.push(line.text);
                ranges.push({ from: line.from, to: Math.min(state.doc.length, line.to + 1) });
            }
            upto = line.number;
        }
        linewise = true;
    }
    return { text: content.join(state.lineBreak), ranges, linewise };
}
let lastLinewiseCopy = null;
handlers.copy = handlers.cut = (view, event) => {
    let { text, ranges, linewise } = copiedRange(view.state);
    if (!text && !linewise)
        return false;
    lastLinewiseCopy = linewise ? text : null;
    if (event.type == "cut" && !view.state.readOnly)
        view.dispatch({
            changes: ranges,
            scrollIntoView: true,
            userEvent: "delete.cut"
        });
    let data = brokenClipboardAPI ? null : event.clipboardData;
    if (data) {
        data.clearData();
        data.setData("text/plain", text);
        return true;
    }
    else {
        captureCopy(view, text);
        return false;
    }
};
const isFocusChange = /*@__PURE__*/Annotation.define();
function focusChangeTransaction(state, focus) {
    let effects = [];
    for (let getEffect of state.facet(focusChangeEffect)) {
        let effect = getEffect(state, focus);
        if (effect)
            effects.push(effect);
    }
    return effects ? state.update({ effects, annotations: isFocusChange.of(true) }) : null;
}
function updateForFocusChange(view) {
    setTimeout(() => {
        let focus = view.hasFocus;
        if (focus != view.inputState.notifiedFocused) {
            let tr = focusChangeTransaction(view.state, focus);
            if (tr)
                view.dispatch(tr);
            else
                view.update([]);
        }
    }, 10);
}
observers.focus = view => {
    view.inputState.lastFocusTime = Date.now();
    // When focusing reset the scroll position, move it back to where it was
    if (!view.scrollDOM.scrollTop && (view.inputState.lastScrollTop || view.inputState.lastScrollLeft)) {
        view.scrollDOM.scrollTop = view.inputState.lastScrollTop;
        view.scrollDOM.scrollLeft = view.inputState.lastScrollLeft;
    }
    updateForFocusChange(view);
};
observers.blur = view => {
    view.observer.clearSelectionRange();
    updateForFocusChange(view);
};
observers.compositionstart = observers.compositionupdate = view => {
    if (view.observer.editContext)
        return; // Composition handled by edit context
    if (view.inputState.compositionFirstChange == null)
        view.inputState.compositionFirstChange = true;
    if (view.inputState.composing < 0) {
        // FIXME possibly set a timeout to clear it again on Android
        view.inputState.composing = 0;
    }
};
observers.compositionend = view => {
    if (view.observer.editContext)
        return; // Composition handled by edit context
    view.inputState.composing = -1;
    view.inputState.compositionEndedAt = Date.now();
    view.inputState.compositionPendingKey = true;
    view.inputState.compositionPendingChange = view.observer.pendingRecords().length > 0;
    view.inputState.compositionFirstChange = null;
    if (browser.chrome && browser.android) {
        // Delay flushing for a bit on Android because it'll often fire a
        // bunch of contradictory changes in a row at end of compositon
        view.observer.flushSoon();
    }
    else if (view.inputState.compositionPendingChange) {
        // If we found pending records, schedule a flush.
        Promise.resolve().then(() => view.observer.flush());
    }
    else {
        // Otherwise, make sure that, if no changes come in soon, the
        // composition view is cleared.
        setTimeout(() => {
            if (view.inputState.composing < 0 && view.docView.hasComposition)
                view.update([]);
        }, 50);
    }
};
observers.contextmenu = view => {
    view.inputState.lastContextMenu = Date.now();
};
handlers.beforeinput = (view, event) => {
    var _a;
    // Because Chrome Android doesn't fire useful key events, use
    // beforeinput to detect backspace (and possibly enter and delete,
    // but those usually don't even seem to fire beforeinput events at
    // the moment) and fake a key event for it.
    //
    // (preventDefault on beforeinput, though supported in the spec,
    // seems to do nothing at all on Chrome).
    let pending;
    if (browser.chrome && browser.android && (pending = PendingKeys.find(key => key.inputType == event.inputType))) {
        view.observer.delayAndroidKey(pending.key, pending.keyCode);
        if (pending.key == "Backspace" || pending.key == "Delete") {
            let startViewHeight = ((_a = window.visualViewport) === null || _a === void 0 ? void 0 : _a.height) || 0;
            setTimeout(() => {
                var _a;
                // Backspacing near uneditable nodes on Chrome Android sometimes
                // closes the virtual keyboard. This tries to crudely detect
                // that and refocus to get it back.
                if ((((_a = window.visualViewport) === null || _a === void 0 ? void 0 : _a.height) || 0) > startViewHeight + 10 && view.hasFocus) {
                    view.contentDOM.blur();
                    view.focus();
                }
            }, 100);
        }
    }
    if (browser.ios && event.inputType == "deleteContentForward") {
        // For some reason, DOM changes (and beforeinput) happen _before_
        // the key event for ctrl-d on iOS when using an external
        // keyboard.
        view.observer.flushSoon();
    }
    // Safari will occasionally forget to fire compositionend at the end of a dead-key composition
    if (browser.safari && event.inputType == "insertText" && view.inputState.composing >= 0) {
        setTimeout(() => observers.compositionend(view, event), 20);
    }
    return false;
};
const appliedFirefoxHack = /*@__PURE__*/new Set;
// In Firefox, when cut/copy handlers are added to the document, that
// somehow avoids a bug where those events aren't fired when the
// selection is empty. See https://github.com/codemirror/dev/issues/1082
// and https://bugzilla.mozilla.org/show_bug.cgi?id=995961
function firefoxCopyCutHack(doc) {
    if (!appliedFirefoxHack.has(doc)) {
        appliedFirefoxHack.add(doc);
        doc.addEventListener("copy", () => { });
        doc.addEventListener("cut", () => { });
    }
}

const wrappingWhiteSpace = ["pre-wrap", "normal", "pre-line", "break-spaces"];
class HeightOracle {
    constructor(lineWrapping) {
        this.lineWrapping = lineWrapping;
        this.doc = Text.empty;
        this.heightSamples = {};
        this.lineHeight = 14; // The height of an entire line (line-height)
        this.charWidth = 7;
        this.textHeight = 14; // The height of the actual font (font-size)
        this.lineLength = 30;
        // Used to track, during updateHeight, if any actual heights changed
        this.heightChanged = false;
    }
    heightForGap(from, to) {
        let lines = this.doc.lineAt(to).number - this.doc.lineAt(from).number + 1;
        if (this.lineWrapping)
            lines += Math.max(0, Math.ceil(((to - from) - (lines * this.lineLength * 0.5)) / this.lineLength));
        return this.lineHeight * lines;
    }
    heightForLine(length) {
        if (!this.lineWrapping)
            return this.lineHeight;
        let lines = 1 + Math.max(0, Math.ceil((length - this.lineLength) / (this.lineLength - 5)));
        return lines * this.lineHeight;
    }
    setDoc(doc) { this.doc = doc; return this; }
    mustRefreshForWrapping(whiteSpace) {
        return (wrappingWhiteSpace.indexOf(whiteSpace) > -1) != this.lineWrapping;
    }
    mustRefreshForHeights(lineHeights) {
        let newHeight = false;
        for (let i = 0; i < lineHeights.length; i++) {
            let h = lineHeights[i];
            if (h < 0) {
                i++;
            }
            else if (!this.heightSamples[Math.floor(h * 10)]) { // Round to .1 pixels
                newHeight = true;
                this.heightSamples[Math.floor(h * 10)] = true;
            }
        }
        return newHeight;
    }
    refresh(whiteSpace, lineHeight, charWidth, textHeight, lineLength, knownHeights) {
        let lineWrapping = wrappingWhiteSpace.indexOf(whiteSpace) > -1;
        let changed = Math.round(lineHeight) != Math.round(this.lineHeight) || this.lineWrapping != lineWrapping;
        this.lineWrapping = lineWrapping;
        this.lineHeight = lineHeight;
        this.charWidth = charWidth;
        this.textHeight = textHeight;
        this.lineLength = lineLength;
        if (changed) {
            this.heightSamples = {};
            for (let i = 0; i < knownHeights.length; i++) {
                let h = knownHeights[i];
                if (h < 0)
                    i++;
                else
                    this.heightSamples[Math.floor(h * 10)] = true;
            }
        }
        return changed;
    }
}
// This object is used by `updateHeight` to make DOM measurements
// arrive at the right nides. The `heights` array is a sequence of
// block heights, starting from position `from`.
class MeasuredHeights {
    constructor(from, heights) {
        this.from = from;
        this.heights = heights;
        this.index = 0;
    }
    get more() { return this.index < this.heights.length; }
}
/**
Record used to represent information about a block-level element
in the editor view.
*/
class BlockInfo {
    /**
    @internal
    */
    constructor(
    /**
    The start of the element in the document.
    */
    from, 
    /**
    The length of the element.
    */
    length, 
    /**
    The top position of the element (relative to the top of the
    document).
    */
    top, 
    /**
    Its height.
    */
    height, 
    /**
    @internal Weird packed field that holds an array of children
    for composite blocks, a decoration for block widgets, and a
    number indicating the amount of widget-create line breaks for
    text blocks.
    */
    _content) {
        this.from = from;
        this.length = length;
        this.top = top;
        this.height = height;
        this._content = _content;
    }
    /**
    The type of element this is. When querying lines, this may be
    an array of all the blocks that make up the line.
    */
    get type() {
        return typeof this._content == "number" ? BlockType.Text :
            Array.isArray(this._content) ? this._content : this._content.type;
    }
    /**
    The end of the element as a document position.
    */
    get to() { return this.from + this.length; }
    /**
    The bottom position of the element.
    */
    get bottom() { return this.top + this.height; }
    /**
    If this is a widget block, this will return the widget
    associated with it.
    */
    get widget() {
        return this._content instanceof PointDecoration ? this._content.widget : null;
    }
    /**
    If this is a textblock, this holds the number of line breaks
    that appear in widgets inside the block.
    */
    get widgetLineBreaks() {
        return typeof this._content == "number" ? this._content : 0;
    }
    /**
    @internal
    */
    join(other) {
        let content = (Array.isArray(this._content) ? this._content : [this])
            .concat(Array.isArray(other._content) ? other._content : [other]);
        return new BlockInfo(this.from, this.length + other.length, this.top, this.height + other.height, content);
    }
}
var QueryType = /*@__PURE__*/(function (QueryType) {
    QueryType[QueryType["ByPos"] = 0] = "ByPos";
    QueryType[QueryType["ByHeight"] = 1] = "ByHeight";
    QueryType[QueryType["ByPosNoHeight"] = 2] = "ByPosNoHeight";
return QueryType})(QueryType || (QueryType = {}));
const Epsilon = 1e-3;
class HeightMap {
    constructor(length, // The number of characters covered
    height, // Height of this part of the document
    flags = 2 /* Flag.Outdated */) {
        this.length = length;
        this.height = height;
        this.flags = flags;
    }
    get outdated() { return (this.flags & 2 /* Flag.Outdated */) > 0; }
    set outdated(value) { this.flags = (value ? 2 /* Flag.Outdated */ : 0) | (this.flags & ~2 /* Flag.Outdated */); }
    setHeight(oracle, height) {
        if (this.height != height) {
            if (Math.abs(this.height - height) > Epsilon)
                oracle.heightChanged = true;
            this.height = height;
        }
    }
    // Base case is to replace a leaf node, which simply builds a tree
    // from the new nodes and returns that (HeightMapBranch and
    // HeightMapGap override this to actually use from/to)
    replace(_from, _to, nodes) {
        return HeightMap.of(nodes);
    }
    // Again, these are base cases, and are overridden for branch and gap nodes.
    decomposeLeft(_to, result) { result.push(this); }
    decomposeRight(_from, result) { result.push(this); }
    applyChanges(decorations, oldDoc, oracle, changes) {
        let me = this, doc = oracle.doc;
        for (let i = changes.length - 1; i >= 0; i--) {
            let { fromA, toA, fromB, toB } = changes[i];
            let start = me.lineAt(fromA, QueryType.ByPosNoHeight, oracle.setDoc(oldDoc), 0, 0);
            let end = start.to >= toA ? start : me.lineAt(toA, QueryType.ByPosNoHeight, oracle, 0, 0);
            toB += end.to - toA;
            toA = end.to;
            while (i > 0 && start.from <= changes[i - 1].toA) {
                fromA = changes[i - 1].fromA;
                fromB = changes[i - 1].fromB;
                i--;
                if (fromA < start.from)
                    start = me.lineAt(fromA, QueryType.ByPosNoHeight, oracle, 0, 0);
            }
            fromB += start.from - fromA;
            fromA = start.from;
            let nodes = NodeBuilder.build(oracle.setDoc(doc), decorations, fromB, toB);
            me = me.replace(fromA, toA, nodes);
        }
        return me.updateHeight(oracle, 0);
    }
    static empty() { return new HeightMapText(0, 0); }
    // nodes uses null values to indicate the position of line breaks.
    // There are never line breaks at the start or end of the array, or
    // two line breaks next to each other, and the array isn't allowed
    // to be empty (same restrictions as return value from the builder).
    static of(nodes) {
        if (nodes.length == 1)
            return nodes[0];
        let i = 0, j = nodes.length, before = 0, after = 0;
        for (;;) {
            if (i == j) {
                if (before > after * 2) {
                    let split = nodes[i - 1];
                    if (split.break)
                        nodes.splice(--i, 1, split.left, null, split.right);
                    else
                        nodes.splice(--i, 1, split.left, split.right);
                    j += 1 + split.break;
                    before -= split.size;
                }
                else if (after > before * 2) {
                    let split = nodes[j];
                    if (split.break)
                        nodes.splice(j, 1, split.left, null, split.right);
                    else
                        nodes.splice(j, 1, split.left, split.right);
                    j += 2 + split.break;
                    after -= split.size;
                }
                else {
                    break;
                }
            }
            else if (before < after) {
                let next = nodes[i++];
                if (next)
                    before += next.size;
            }
            else {
                let next = nodes[--j];
                if (next)
                    after += next.size;
            }
        }
        let brk = 0;
        if (nodes[i - 1] == null) {
            brk = 1;
            i--;
        }
        else if (nodes[i] == null) {
            brk = 1;
            j++;
        }
        return new HeightMapBranch(HeightMap.of(nodes.slice(0, i)), brk, HeightMap.of(nodes.slice(j)));
    }
}
HeightMap.prototype.size = 1;
class HeightMapBlock extends HeightMap {
    constructor(length, height, deco) {
        super(length, height);
        this.deco = deco;
    }
    blockAt(_height, _oracle, top, offset) {
        return new BlockInfo(offset, this.length, top, this.height, this.deco || 0);
    }
    lineAt(_value, _type, oracle, top, offset) {
        return this.blockAt(0, oracle, top, offset);
    }
    forEachLine(from, to, oracle, top, offset, f) {
        if (from <= offset + this.length && to >= offset)
            f(this.blockAt(0, oracle, top, offset));
    }
    updateHeight(oracle, offset = 0, _force = false, measured) {
        if (measured && measured.from <= offset && measured.more)
            this.setHeight(oracle, measured.heights[measured.index++]);
        this.outdated = false;
        return this;
    }
    toString() { return `block(${this.length})`; }
}
class HeightMapText extends HeightMapBlock {
    constructor(length, height) {
        super(length, height, null);
        this.collapsed = 0; // Amount of collapsed content in the line
        this.widgetHeight = 0; // Maximum inline widget height
        this.breaks = 0; // Number of widget-introduced line breaks on the line
    }
    blockAt(_height, _oracle, top, offset) {
        return new BlockInfo(offset, this.length, top, this.height, this.breaks);
    }
    replace(_from, _to, nodes) {
        let node = nodes[0];
        if (nodes.length == 1 && (node instanceof HeightMapText || node instanceof HeightMapGap && (node.flags & 4 /* Flag.SingleLine */)) &&
            Math.abs(this.length - node.length) < 10) {
            if (node instanceof HeightMapGap)
                node = new HeightMapText(node.length, this.height);
            else
                node.height = this.height;
            if (!this.outdated)
                node.outdated = false;
            return node;
        }
        else {
            return HeightMap.of(nodes);
        }
    }
    updateHeight(oracle, offset = 0, force = false, measured) {
        if (measured && measured.from <= offset && measured.more)
            this.setHeight(oracle, measured.heights[measured.index++]);
        else if (force || this.outdated)
            this.setHeight(oracle, Math.max(this.widgetHeight, oracle.heightForLine(this.length - this.collapsed)) +
                this.breaks * oracle.lineHeight);
        this.outdated = false;
        return this;
    }
    toString() {
        return `line(${this.length}${this.collapsed ? -this.collapsed : ""}${this.widgetHeight ? ":" + this.widgetHeight : ""})`;
    }
}
class HeightMapGap extends HeightMap {
    constructor(length) { super(length, 0); }
    heightMetrics(oracle, offset) {
        let firstLine = oracle.doc.lineAt(offset).number, lastLine = oracle.doc.lineAt(offset + this.length).number;
        let lines = lastLine - firstLine + 1;
        let perLine, perChar = 0;
        if (oracle.lineWrapping) {
            let totalPerLine = Math.min(this.height, oracle.lineHeight * lines);
            perLine = totalPerLine / lines;
            if (this.length > lines + 1)
                perChar = (this.height - totalPerLine) / (this.length - lines - 1);
        }
        else {
            perLine = this.height / lines;
        }
        return { firstLine, lastLine, perLine, perChar };
    }
    blockAt(height, oracle, top, offset) {
        let { firstLine, lastLine, perLine, perChar } = this.heightMetrics(oracle, offset);
        if (oracle.lineWrapping) {
            let guess = offset + (height < oracle.lineHeight ? 0
                : Math.round(Math.max(0, Math.min(1, (height - top) / this.height)) * this.length));
            let line = oracle.doc.lineAt(guess), lineHeight = perLine + line.length * perChar;
            let lineTop = Math.max(top, height - lineHeight / 2);
            return new BlockInfo(line.from, line.length, lineTop, lineHeight, 0);
        }
        else {
            let line = Math.max(0, Math.min(lastLine - firstLine, Math.floor((height - top) / perLine)));
            let { from, length } = oracle.doc.line(firstLine + line);
            return new BlockInfo(from, length, top + perLine * line, perLine, 0);
        }
    }
    lineAt(value, type, oracle, top, offset) {
        if (type == QueryType.ByHeight)
            return this.blockAt(value, oracle, top, offset);
        if (type == QueryType.ByPosNoHeight) {
            let { from, to } = oracle.doc.lineAt(value);
            return new BlockInfo(from, to - from, 0, 0, 0);
        }
        let { firstLine, perLine, perChar } = this.heightMetrics(oracle, offset);
        let line = oracle.doc.lineAt(value), lineHeight = perLine + line.length * perChar;
        let linesAbove = line.number - firstLine;
        let lineTop = top + perLine * linesAbove + perChar * (line.from - offset - linesAbove);
        return new BlockInfo(line.from, line.length, Math.max(top, Math.min(lineTop, top + this.height - lineHeight)), lineHeight, 0);
    }
    forEachLine(from, to, oracle, top, offset, f) {
        from = Math.max(from, offset);
        to = Math.min(to, offset + this.length);
        let { firstLine, perLine, perChar } = this.heightMetrics(oracle, offset);
        for (let pos = from, lineTop = top; pos <= to;) {
            let line = oracle.doc.lineAt(pos);
            if (pos == from) {
                let linesAbove = line.number - firstLine;
                lineTop += perLine * linesAbove + perChar * (from - offset - linesAbove);
            }
            let lineHeight = perLine + perChar * line.length;
            f(new BlockInfo(line.from, line.length, lineTop, lineHeight, 0));
            lineTop += lineHeight;
            pos = line.to + 1;
        }
    }
    replace(from, to, nodes) {
        let after = this.length - to;
        if (after > 0) {
            let last = nodes[nodes.length - 1];
            if (last instanceof HeightMapGap)
                nodes[nodes.length - 1] = new HeightMapGap(last.length + after);
            else
                nodes.push(null, new HeightMapGap(after - 1));
        }
        if (from > 0) {
            let first = nodes[0];
            if (first instanceof HeightMapGap)
                nodes[0] = new HeightMapGap(from + first.length);
            else
                nodes.unshift(new HeightMapGap(from - 1), null);
        }
        return HeightMap.of(nodes);
    }
    decomposeLeft(to, result) {
        result.push(new HeightMapGap(to - 1), null);
    }
    decomposeRight(from, result) {
        result.push(null, new HeightMapGap(this.length - from - 1));
    }
    updateHeight(oracle, offset = 0, force = false, measured) {
        let end = offset + this.length;
        if (measured && measured.from <= offset + this.length && measured.more) {
            // Fill in part of this gap with measured lines. We know there
            // can't be widgets or collapsed ranges in those lines, because
            // they would already have been added to the heightmap (gaps
            // only contain plain text).
            let nodes = [], pos = Math.max(offset, measured.from), singleHeight = -1;
            if (measured.from > offset)
                nodes.push(new HeightMapGap(measured.from - offset - 1).updateHeight(oracle, offset));
            while (pos <= end && measured.more) {
                let len = oracle.doc.lineAt(pos).length;
                if (nodes.length)
                    nodes.push(null);
                let height = measured.heights[measured.index++];
                if (singleHeight == -1)
                    singleHeight = height;
                else if (Math.abs(height - singleHeight) >= Epsilon)
                    singleHeight = -2;
                let line = new HeightMapText(len, height);
                line.outdated = false;
                nodes.push(line);
                pos += len + 1;
            }
            if (pos <= end)
                nodes.push(null, new HeightMapGap(end - pos).updateHeight(oracle, pos));
            let result = HeightMap.of(nodes);
            if (singleHeight < 0 || Math.abs(result.height - this.height) >= Epsilon ||
                Math.abs(singleHeight - this.heightMetrics(oracle, offset).perLine) >= Epsilon)
                oracle.heightChanged = true;
            return result;
        }
        else if (force || this.outdated) {
            this.setHeight(oracle, oracle.heightForGap(offset, offset + this.length));
            this.outdated = false;
        }
        return this;
    }
    toString() { return `gap(${this.length})`; }
}
class HeightMapBranch extends HeightMap {
    constructor(left, brk, right) {
        super(left.length + brk + right.length, left.height + right.height, brk | (left.outdated || right.outdated ? 2 /* Flag.Outdated */ : 0));
        this.left = left;
        this.right = right;
        this.size = left.size + right.size;
    }
    get break() { return this.flags & 1 /* Flag.Break */; }
    blockAt(height, oracle, top, offset) {
        let mid = top + this.left.height;
        return height < mid ? this.left.blockAt(height, oracle, top, offset)
            : this.right.blockAt(height, oracle, mid, offset + this.left.length + this.break);
    }
    lineAt(value, type, oracle, top, offset) {
        let rightTop = top + this.left.height, rightOffset = offset + this.left.length + this.break;
        let left = type == QueryType.ByHeight ? value < rightTop : value < rightOffset;
        let base = left ? this.left.lineAt(value, type, oracle, top, offset)
            : this.right.lineAt(value, type, oracle, rightTop, rightOffset);
        if (this.break || (left ? base.to < rightOffset : base.from > rightOffset))
            return base;
        let subQuery = type == QueryType.ByPosNoHeight ? QueryType.ByPosNoHeight : QueryType.ByPos;
        if (left)
            return base.join(this.right.lineAt(rightOffset, subQuery, oracle, rightTop, rightOffset));
        else
            return this.left.lineAt(rightOffset, subQuery, oracle, top, offset).join(base);
    }
    forEachLine(from, to, oracle, top, offset, f) {
        let rightTop = top + this.left.height, rightOffset = offset + this.left.length + this.break;
        if (this.break) {
            if (from < rightOffset)
                this.left.forEachLine(from, to, oracle, top, offset, f);
            if (to >= rightOffset)
                this.right.forEachLine(from, to, oracle, rightTop, rightOffset, f);
        }
        else {
            let mid = this.lineAt(rightOffset, QueryType.ByPos, oracle, top, offset);
            if (from < mid.from)
                this.left.forEachLine(from, mid.from - 1, oracle, top, offset, f);
            if (mid.to >= from && mid.from <= to)
                f(mid);
            if (to > mid.to)
                this.right.forEachLine(mid.to + 1, to, oracle, rightTop, rightOffset, f);
        }
    }
    replace(from, to, nodes) {
        let rightStart = this.left.length + this.break;
        if (to < rightStart)
            return this.balanced(this.left.replace(from, to, nodes), this.right);
        if (from > this.left.length)
            return this.balanced(this.left, this.right.replace(from - rightStart, to - rightStart, nodes));
        let result = [];
        if (from > 0)
            this.decomposeLeft(from, result);
        let left = result.length;
        for (let node of nodes)
            result.push(node);
        if (from > 0)
            mergeGaps(result, left - 1);
        if (to < this.length) {
            let right = result.length;
            this.decomposeRight(to, result);
            mergeGaps(result, right);
        }
        return HeightMap.of(result);
    }
    decomposeLeft(to, result) {
        let left = this.left.length;
        if (to <= left)
            return this.left.decomposeLeft(to, result);
        result.push(this.left);
        if (this.break) {
            left++;
            if (to >= left)
                result.push(null);
        }
        if (to > left)
            this.right.decomposeLeft(to - left, result);
    }
    decomposeRight(from, result) {
        let left = this.left.length, right = left + this.break;
        if (from >= right)
            return this.right.decomposeRight(from - right, result);
        if (from < left)
            this.left.decomposeRight(from, result);
        if (this.break && from < right)
            result.push(null);
        result.push(this.right);
    }
    balanced(left, right) {
        if (left.size > 2 * right.size || right.size > 2 * left.size)
            return HeightMap.of(this.break ? [left, null, right] : [left, right]);
        this.left = left;
        this.right = right;
        this.height = left.height + right.height;
        this.outdated = left.outdated || right.outdated;
        this.size = left.size + right.size;
        this.length = left.length + this.break + right.length;
        return this;
    }
    updateHeight(oracle, offset = 0, force = false, measured) {
        let { left, right } = this, rightStart = offset + left.length + this.break, rebalance = null;
        if (measured && measured.from <= offset + left.length && measured.more)
            rebalance = left = left.updateHeight(oracle, offset, force, measured);
        else
            left.updateHeight(oracle, offset, force);
        if (measured && measured.from <= rightStart + right.length && measured.more)
            rebalance = right = right.updateHeight(oracle, rightStart, force, measured);
        else
            right.updateHeight(oracle, rightStart, force);
        if (rebalance)
            return this.balanced(left, right);
        this.height = this.left.height + this.right.height;
        this.outdated = false;
        return this;
    }
    toString() { return this.left + (this.break ? " " : "-") + this.right; }
}
function mergeGaps(nodes, around) {
    let before, after;
    if (nodes[around] == null &&
        (before = nodes[around - 1]) instanceof HeightMapGap &&
        (after = nodes[around + 1]) instanceof HeightMapGap)
        nodes.splice(around - 1, 3, new HeightMapGap(before.length + 1 + after.length));
}
const relevantWidgetHeight = 5;
class NodeBuilder {
    constructor(pos, oracle) {
        this.pos = pos;
        this.oracle = oracle;
        this.nodes = [];
        this.lineStart = -1;
        this.lineEnd = -1;
        this.covering = null;
        this.writtenTo = pos;
    }
    get isCovered() {
        return this.covering && this.nodes[this.nodes.length - 1] == this.covering;
    }
    span(_from, to) {
        if (this.lineStart > -1) {
            let end = Math.min(to, this.lineEnd), last = this.nodes[this.nodes.length - 1];
            if (last instanceof HeightMapText)
                last.length += end - this.pos;
            else if (end > this.pos || !this.isCovered)
                this.nodes.push(new HeightMapText(end - this.pos, -1));
            this.writtenTo = end;
            if (to > end) {
                this.nodes.push(null);
                this.writtenTo++;
                this.lineStart = -1;
            }
        }
        this.pos = to;
    }
    point(from, to, deco) {
        if (from < to || deco.heightRelevant) {
            let height = deco.widget ? deco.widget.estimatedHeight : 0;
            let breaks = deco.widget ? deco.widget.lineBreaks : 0;
            if (height < 0)
                height = this.oracle.lineHeight;
            let len = to - from;
            if (deco.block) {
                this.addBlock(new HeightMapBlock(len, height, deco));
            }
            else if (len || breaks || height >= relevantWidgetHeight) {
                this.addLineDeco(height, breaks, len);
            }
        }
        else if (to > from) {
            this.span(from, to);
        }
        if (this.lineEnd > -1 && this.lineEnd < this.pos)
            this.lineEnd = this.oracle.doc.lineAt(this.pos).to;
    }
    enterLine() {
        if (this.lineStart > -1)
            return;
        let { from, to } = this.oracle.doc.lineAt(this.pos);
        this.lineStart = from;
        this.lineEnd = to;
        if (this.writtenTo < from) {
            if (this.writtenTo < from - 1 || this.nodes[this.nodes.length - 1] == null)
                this.nodes.push(this.blankContent(this.writtenTo, from - 1));
            this.nodes.push(null);
        }
        if (this.pos > from)
            this.nodes.push(new HeightMapText(this.pos - from, -1));
        this.writtenTo = this.pos;
    }
    blankContent(from, to) {
        let gap = new HeightMapGap(to - from);
        if (this.oracle.doc.lineAt(from).to == to)
            gap.flags |= 4 /* Flag.SingleLine */;
        return gap;
    }
    ensureLine() {
        this.enterLine();
        let last = this.nodes.length ? this.nodes[this.nodes.length - 1] : null;
        if (last instanceof HeightMapText)
            return last;
        let line = new HeightMapText(0, -1);
        this.nodes.push(line);
        return line;
    }
    addBlock(block) {
        this.enterLine();
        let deco = block.deco;
        if (deco && deco.startSide > 0 && !this.isCovered)
            this.ensureLine();
        this.nodes.push(block);
        this.writtenTo = this.pos = this.pos + block.length;
        if (deco && deco.endSide > 0)
            this.covering = block;
    }
    addLineDeco(height, breaks, length) {
        let line = this.ensureLine();
        line.length += length;
        line.collapsed += length;
        line.widgetHeight = Math.max(line.widgetHeight, height);
        line.breaks += breaks;
        this.writtenTo = this.pos = this.pos + length;
    }
    finish(from) {
        let last = this.nodes.length == 0 ? null : this.nodes[this.nodes.length - 1];
        if (this.lineStart > -1 && !(last instanceof HeightMapText) && !this.isCovered)
            this.nodes.push(new HeightMapText(0, -1));
        else if (this.writtenTo < this.pos || last == null)
            this.nodes.push(this.blankContent(this.writtenTo, this.pos));
        let pos = from;
        for (let node of this.nodes) {
            if (node instanceof HeightMapText)
                node.updateHeight(this.oracle, pos);
            pos += node ? node.length : 1;
        }
        return this.nodes;
    }
    // Always called with a region that on both sides either stretches
    // to a line break or the end of the document.
    // The returned array uses null to indicate line breaks, but never
    // starts or ends in a line break, or has multiple line breaks next
    // to each other.
    static build(oracle, decorations, from, to) {
        let builder = new NodeBuilder(from, oracle);
        RangeSet.spans(decorations, from, to, builder, 0);
        return builder.finish(from);
    }
}
function heightRelevantDecoChanges(a, b, diff) {
    let comp = new DecorationComparator;
    RangeSet.compare(a, b, diff, comp, 0);
    return comp.changes;
}
class DecorationComparator {
    constructor() {
        this.changes = [];
    }
    compareRange() { }
    comparePoint(from, to, a, b) {
        if (from < to || a && a.heightRelevant || b && b.heightRelevant)
            addRange(from, to, this.changes, 5);
    }
}

function visiblePixelRange(dom, paddingTop) {
    let rect = dom.getBoundingClientRect();
    let doc = dom.ownerDocument, win = doc.defaultView || window;
    let left = Math.max(0, rect.left), right = Math.min(win.innerWidth, rect.right);
    let top = Math.max(0, rect.top), bottom = Math.min(win.innerHeight, rect.bottom);
    for (let parent = dom.parentNode; parent && parent != doc.body;) {
        if (parent.nodeType == 1) {
            let elt = parent;
            let style = window.getComputedStyle(elt);
            if ((elt.scrollHeight > elt.clientHeight || elt.scrollWidth > elt.clientWidth) &&
                style.overflow != "visible") {
                let parentRect = elt.getBoundingClientRect();
                left = Math.max(left, parentRect.left);
                right = Math.min(right, parentRect.right);
                top = Math.max(top, parentRect.top);
                bottom = parent == dom.parentNode ? parentRect.bottom : Math.min(bottom, parentRect.bottom);
            }
            parent = style.position == "absolute" || style.position == "fixed" ? elt.offsetParent : elt.parentNode;
        }
        else if (parent.nodeType == 11) { // Shadow root
            parent = parent.host;
        }
        else {
            break;
        }
    }
    return { left: left - rect.left, right: Math.max(left, right) - rect.left,
        top: top - (rect.top + paddingTop), bottom: Math.max(top, bottom) - (rect.top + paddingTop) };
}
function fullPixelRange(dom, paddingTop) {
    let rect = dom.getBoundingClientRect();
    return { left: 0, right: rect.right - rect.left,
        top: paddingTop, bottom: rect.bottom - (rect.top + paddingTop) };
}
// Line gaps are placeholder widgets used to hide pieces of overlong
// lines within the viewport, as a kludge to keep the editor
// responsive when a ridiculously long line is loaded into it.
class LineGap {
    constructor(from, to, size) {
        this.from = from;
        this.to = to;
        this.size = size;
    }
    static same(a, b) {
        if (a.length != b.length)
            return false;
        for (let i = 0; i < a.length; i++) {
            let gA = a[i], gB = b[i];
            if (gA.from != gB.from || gA.to != gB.to || gA.size != gB.size)
                return false;
        }
        return true;
    }
    draw(viewState, wrapping) {
        return Decoration.replace({
            widget: new LineGapWidget(this.size * (wrapping ? viewState.scaleY : viewState.scaleX), wrapping)
        }).range(this.from, this.to);
    }
}
class LineGapWidget extends WidgetType {
    constructor(size, vertical) {
        super();
        this.size = size;
        this.vertical = vertical;
    }
    eq(other) { return other.size == this.size && other.vertical == this.vertical; }
    toDOM() {
        let elt = document.createElement("div");
        if (this.vertical) {
            elt.style.height = this.size + "px";
        }
        else {
            elt.style.width = this.size + "px";
            elt.style.height = "2px";
            elt.style.display = "inline-block";
        }
        return elt;
    }
    get estimatedHeight() { return this.vertical ? this.size : -1; }
}
class ViewState {
    constructor(state) {
        this.state = state;
        // These are contentDOM-local coordinates
        this.pixelViewport = { left: 0, right: window.innerWidth, top: 0, bottom: 0 };
        this.inView = true;
        this.paddingTop = 0; // Padding above the document, scaled
        this.paddingBottom = 0; // Padding below the document, scaled
        this.contentDOMWidth = 0; // contentDOM.getBoundingClientRect().width
        this.contentDOMHeight = 0; // contentDOM.getBoundingClientRect().height
        this.editorHeight = 0; // scrollDOM.clientHeight, unscaled
        this.editorWidth = 0; // scrollDOM.clientWidth, unscaled
        this.scrollTop = 0; // Last seen scrollDOM.scrollTop, scaled
        this.scrolledToBottom = false;
        // The CSS-transformation scale of the editor (transformed size /
        // concrete size)
        this.scaleX = 1;
        this.scaleY = 1;
        // The vertical position (document-relative) to which to anchor the
        // scroll position. -1 means anchor to the end of the document.
        this.scrollAnchorPos = 0;
        // The height at the anchor position. Set by the DOM update phase.
        // -1 means no height available.
        this.scrollAnchorHeight = -1;
        // See VP.MaxDOMHeight
        this.scaler = IdScaler;
        this.scrollTarget = null;
        // Briefly set to true when printing, to disable viewport limiting
        this.printing = false;
        // Flag set when editor content was redrawn, so that the next
        // measure stage knows it must read DOM layout
        this.mustMeasureContent = true;
        this.defaultTextDirection = Direction.LTR;
        this.visibleRanges = [];
        // Cursor 'assoc' is only significant when the cursor is on a line
        // wrap point, where it must stick to the character that it is
        // associated with. Since browsers don't provide a reasonable
        // interface to set or query this, when a selection is set that
        // might cause this to be significant, this flag is set. The next
        // measure phase will check whether the cursor is on a line-wrapping
        // boundary and, if so, reset it to make sure it is positioned in
        // the right place.
        this.mustEnforceCursorAssoc = false;
        let guessWrapping = state.facet(contentAttributes).some(v => typeof v != "function" && v.class == "cm-lineWrapping");
        this.heightOracle = new HeightOracle(guessWrapping);
        this.stateDeco = state.facet(decorations).filter(d => typeof d != "function");
        this.heightMap = HeightMap.empty().applyChanges(this.stateDeco, Text.empty, this.heightOracle.setDoc(state.doc), [new ChangedRange(0, 0, 0, state.doc.length)]);
        for (let i = 0; i < 2; i++) {
            this.viewport = this.getViewport(0, null);
            if (!this.updateForViewport())
                break;
        }
        this.updateViewportLines();
        this.lineGaps = this.ensureLineGaps([]);
        this.lineGapDeco = Decoration.set(this.lineGaps.map(gap => gap.draw(this, false)));
        this.computeVisibleRanges();
    }
    updateForViewport() {
        let viewports = [this.viewport], { main } = this.state.selection;
        for (let i = 0; i <= 1; i++) {
            let pos = i ? main.head : main.anchor;
            if (!viewports.some(({ from, to }) => pos >= from && pos <= to)) {
                let { from, to } = this.lineBlockAt(pos);
                viewports.push(new Viewport(from, to));
            }
        }
        this.viewports = viewports.sort((a, b) => a.from - b.from);
        return this.updateScaler();
    }
    updateScaler() {
        let scaler = this.scaler;
        this.scaler = this.heightMap.height <= 7000000 /* VP.MaxDOMHeight */ ? IdScaler :
            new BigScaler(this.heightOracle, this.heightMap, this.viewports);
        return scaler.eq(this.scaler) ? 0 : 2 /* UpdateFlag.Height */;
    }
    updateViewportLines() {
        this.viewportLines = [];
        this.heightMap.forEachLine(this.viewport.from, this.viewport.to, this.heightOracle.setDoc(this.state.doc), 0, 0, block => {
            this.viewportLines.push(scaleBlock(block, this.scaler));
        });
    }
    update(update, scrollTarget = null) {
        this.state = update.state;
        let prevDeco = this.stateDeco;
        this.stateDeco = this.state.facet(decorations).filter(d => typeof d != "function");
        let contentChanges = update.changedRanges;
        let heightChanges = ChangedRange.extendWithRanges(contentChanges, heightRelevantDecoChanges(prevDeco, this.stateDeco, update ? update.changes : ChangeSet.empty(this.state.doc.length)));
        let prevHeight = this.heightMap.height;
        let scrollAnchor = this.scrolledToBottom ? null : this.scrollAnchorAt(this.scrollTop);
        this.heightMap = this.heightMap.applyChanges(this.stateDeco, update.startState.doc, this.heightOracle.setDoc(this.state.doc), heightChanges);
        if (this.heightMap.height != prevHeight)
            update.flags |= 2 /* UpdateFlag.Height */;
        if (scrollAnchor) {
            this.scrollAnchorPos = update.changes.mapPos(scrollAnchor.from, -1);
            this.scrollAnchorHeight = scrollAnchor.top;
        }
        else {
            this.scrollAnchorPos = -1;
            this.scrollAnchorHeight = this.heightMap.height;
        }
        let viewport = heightChanges.length ? this.mapViewport(this.viewport, update.changes) : this.viewport;
        if (scrollTarget && (scrollTarget.range.head < viewport.from || scrollTarget.range.head > viewport.to) ||
            !this.viewportIsAppropriate(viewport))
            viewport = this.getViewport(0, scrollTarget);
        let viewportChange = viewport.from != this.viewport.from || viewport.to != this.viewport.to;
        this.viewport = viewport;
        update.flags |= this.updateForViewport();
        if (viewportChange || !update.changes.empty || (update.flags & 2 /* UpdateFlag.Height */))
            this.updateViewportLines();
        if (this.lineGaps.length || this.viewport.to - this.viewport.from > (2000 /* LG.Margin */ << 1))
            this.updateLineGaps(this.ensureLineGaps(this.mapLineGaps(this.lineGaps, update.changes)));
        update.flags |= this.computeVisibleRanges();
        if (scrollTarget)
            this.scrollTarget = scrollTarget;
        if (!this.mustEnforceCursorAssoc && update.selectionSet && update.view.lineWrapping &&
            update.state.selection.main.empty && update.state.selection.main.assoc &&
            !update.state.facet(nativeSelectionHidden))
            this.mustEnforceCursorAssoc = true;
    }
    measure(view) {
        let dom = view.contentDOM, style = window.getComputedStyle(dom);
        let oracle = this.heightOracle;
        let whiteSpace = style.whiteSpace;
        this.defaultTextDirection = style.direction == "rtl" ? Direction.RTL : Direction.LTR;
        let refresh = this.heightOracle.mustRefreshForWrapping(whiteSpace);
        let domRect = dom.getBoundingClientRect();
        let measureContent = refresh || this.mustMeasureContent || this.contentDOMHeight != domRect.height;
        this.contentDOMHeight = domRect.height;
        this.mustMeasureContent = false;
        let result = 0, bias = 0;
        if (domRect.width && domRect.height) {
            let { scaleX, scaleY } = getScale(dom, domRect);
            if (scaleX > .005 && Math.abs(this.scaleX - scaleX) > .005 ||
                scaleY > .005 && Math.abs(this.scaleY - scaleY) > .005) {
                this.scaleX = scaleX;
                this.scaleY = scaleY;
                result |= 8 /* UpdateFlag.Geometry */;
                refresh = measureContent = true;
            }
        }
        // Vertical padding
        let paddingTop = (parseInt(style.paddingTop) || 0) * this.scaleY;
        let paddingBottom = (parseInt(style.paddingBottom) || 0) * this.scaleY;
        if (this.paddingTop != paddingTop || this.paddingBottom != paddingBottom) {
            this.paddingTop = paddingTop;
            this.paddingBottom = paddingBottom;
            result |= 8 /* UpdateFlag.Geometry */ | 2 /* UpdateFlag.Height */;
        }
        if (this.editorWidth != view.scrollDOM.clientWidth) {
            if (oracle.lineWrapping)
                measureContent = true;
            this.editorWidth = view.scrollDOM.clientWidth;
            result |= 8 /* UpdateFlag.Geometry */;
        }
        let scrollTop = view.scrollDOM.scrollTop * this.scaleY;
        if (this.scrollTop != scrollTop) {
            this.scrollAnchorHeight = -1;
            this.scrollTop = scrollTop;
        }
        this.scrolledToBottom = isScrolledToBottom(view.scrollDOM);
        // Pixel viewport
        let pixelViewport = (this.printing ? fullPixelRange : visiblePixelRange)(dom, this.paddingTop);
        let dTop = pixelViewport.top - this.pixelViewport.top, dBottom = pixelViewport.bottom - this.pixelViewport.bottom;
        this.pixelViewport = pixelViewport;
        let inView = this.pixelViewport.bottom > this.pixelViewport.top && this.pixelViewport.right > this.pixelViewport.left;
        if (inView != this.inView) {
            this.inView = inView;
            if (inView)
                measureContent = true;
        }
        if (!this.inView && !this.scrollTarget)
            return 0;
        let contentWidth = domRect.width;
        if (this.contentDOMWidth != contentWidth || this.editorHeight != view.scrollDOM.clientHeight) {
            this.contentDOMWidth = domRect.width;
            this.editorHeight = view.scrollDOM.clientHeight;
            result |= 8 /* UpdateFlag.Geometry */;
        }
        if (measureContent) {
            let lineHeights = view.docView.measureVisibleLineHeights(this.viewport);
            if (oracle.mustRefreshForHeights(lineHeights))
                refresh = true;
            if (refresh || oracle.lineWrapping && Math.abs(contentWidth - this.contentDOMWidth) > oracle.charWidth) {
                let { lineHeight, charWidth, textHeight } = view.docView.measureTextSize();
                refresh = lineHeight > 0 && oracle.refresh(whiteSpace, lineHeight, charWidth, textHeight, contentWidth / charWidth, lineHeights);
                if (refresh) {
                    view.docView.minWidth = 0;
                    result |= 8 /* UpdateFlag.Geometry */;
                }
            }
            if (dTop > 0 && dBottom > 0)
                bias = Math.max(dTop, dBottom);
            else if (dTop < 0 && dBottom < 0)
                bias = Math.min(dTop, dBottom);
            oracle.heightChanged = false;
            for (let vp of this.viewports) {
                let heights = vp.from == this.viewport.from ? lineHeights : view.docView.measureVisibleLineHeights(vp);
                this.heightMap = (refresh ? HeightMap.empty().applyChanges(this.stateDeco, Text.empty, this.heightOracle, [new ChangedRange(0, 0, 0, view.state.doc.length)]) : this.heightMap).updateHeight(oracle, 0, refresh, new MeasuredHeights(vp.from, heights));
            }
            if (oracle.heightChanged)
                result |= 2 /* UpdateFlag.Height */;
        }
        let viewportChange = !this.viewportIsAppropriate(this.viewport, bias) ||
            this.scrollTarget && (this.scrollTarget.range.head < this.viewport.from ||
                this.scrollTarget.range.head > this.viewport.to);
        if (viewportChange) {
            if (result & 2 /* UpdateFlag.Height */)
                result |= this.updateScaler();
            this.viewport = this.getViewport(bias, this.scrollTarget);
            result |= this.updateForViewport();
        }
        if ((result & 2 /* UpdateFlag.Height */) || viewportChange)
            this.updateViewportLines();
        if (this.lineGaps.length || this.viewport.to - this.viewport.from > (2000 /* LG.Margin */ << 1))
            this.updateLineGaps(this.ensureLineGaps(refresh ? [] : this.lineGaps, view));
        result |= this.computeVisibleRanges();
        if (this.mustEnforceCursorAssoc) {
            this.mustEnforceCursorAssoc = false;
            // This is done in the read stage, because moving the selection
            // to a line end is going to trigger a layout anyway, so it
            // can't be a pure write. It should be rare that it does any
            // writing.
            view.docView.enforceCursorAssoc();
        }
        return result;
    }
    get visibleTop() { return this.scaler.fromDOM(this.pixelViewport.top); }
    get visibleBottom() { return this.scaler.fromDOM(this.pixelViewport.bottom); }
    getViewport(bias, scrollTarget) {
        // This will divide VP.Margin between the top and the
        // bottom, depending on the bias (the change in viewport position
        // since the last update). It'll hold a number between 0 and 1
        let marginTop = 0.5 - Math.max(-0.5, Math.min(0.5, bias / 1000 /* VP.Margin */ / 2));
        let map = this.heightMap, oracle = this.heightOracle;
        let { visibleTop, visibleBottom } = this;
        let viewport = new Viewport(map.lineAt(visibleTop - marginTop * 1000 /* VP.Margin */, QueryType.ByHeight, oracle, 0, 0).from, map.lineAt(visibleBottom + (1 - marginTop) * 1000 /* VP.Margin */, QueryType.ByHeight, oracle, 0, 0).to);
        // If scrollTarget is given, make sure the viewport includes that position
        if (scrollTarget) {
            let { head } = scrollTarget.range;
            if (head < viewport.from || head > viewport.to) {
                let viewHeight = Math.min(this.editorHeight, this.pixelViewport.bottom - this.pixelViewport.top);
                let block = map.lineAt(head, QueryType.ByPos, oracle, 0, 0), topPos;
                if (scrollTarget.y == "center")
                    topPos = (block.top + block.bottom) / 2 - viewHeight / 2;
                else if (scrollTarget.y == "start" || scrollTarget.y == "nearest" && head < viewport.from)
                    topPos = block.top;
                else
                    topPos = block.bottom - viewHeight;
                viewport = new Viewport(map.lineAt(topPos - 1000 /* VP.Margin */ / 2, QueryType.ByHeight, oracle, 0, 0).from, map.lineAt(topPos + viewHeight + 1000 /* VP.Margin */ / 2, QueryType.ByHeight, oracle, 0, 0).to);
            }
        }
        return viewport;
    }
    mapViewport(viewport, changes) {
        let from = changes.mapPos(viewport.from, -1), to = changes.mapPos(viewport.to, 1);
        return new Viewport(this.heightMap.lineAt(from, QueryType.ByPos, this.heightOracle, 0, 0).from, this.heightMap.lineAt(to, QueryType.ByPos, this.heightOracle, 0, 0).to);
    }
    // Checks if a given viewport covers the visible part of the
    // document and not too much beyond that.
    viewportIsAppropriate({ from, to }, bias = 0) {
        if (!this.inView)
            return true;
        let { top } = this.heightMap.lineAt(from, QueryType.ByPos, this.heightOracle, 0, 0);
        let { bottom } = this.heightMap.lineAt(to, QueryType.ByPos, this.heightOracle, 0, 0);
        let { visibleTop, visibleBottom } = this;
        return (from == 0 || top <= visibleTop - Math.max(10 /* VP.MinCoverMargin */, Math.min(-bias, 250 /* VP.MaxCoverMargin */))) &&
            (to == this.state.doc.length ||
                bottom >= visibleBottom + Math.max(10 /* VP.MinCoverMargin */, Math.min(bias, 250 /* VP.MaxCoverMargin */))) &&
            (top > visibleTop - 2 * 1000 /* VP.Margin */ && bottom < visibleBottom + 2 * 1000 /* VP.Margin */);
    }
    mapLineGaps(gaps, changes) {
        if (!gaps.length || changes.empty)
            return gaps;
        let mapped = [];
        for (let gap of gaps)
            if (!changes.touchesRange(gap.from, gap.to))
                mapped.push(new LineGap(changes.mapPos(gap.from), changes.mapPos(gap.to), gap.size));
        return mapped;
    }
    // Computes positions in the viewport where the start or end of a
    // line should be hidden, trying to reuse existing line gaps when
    // appropriate to avoid unneccesary redraws.
    // Uses crude character-counting for the positioning and sizing,
    // since actual DOM coordinates aren't always available and
    // predictable. Relies on generous margins (see LG.Margin) to hide
    // the artifacts this might produce from the user.
    ensureLineGaps(current, mayMeasure) {
        let wrapping = this.heightOracle.lineWrapping;
        let margin = wrapping ? 10000 /* LG.MarginWrap */ : 2000 /* LG.Margin */, halfMargin = margin >> 1, doubleMargin = margin << 1;
        // The non-wrapping logic won't work at all in predominantly right-to-left text.
        if (this.defaultTextDirection != Direction.LTR && !wrapping)
            return [];
        let gaps = [];
        let addGap = (from, to, line, structure) => {
            if (to - from < halfMargin)
                return;
            let sel = this.state.selection.main, avoid = [sel.from];
            if (!sel.empty)
                avoid.push(sel.to);
            for (let pos of avoid) {
                if (pos > from && pos < to) {
                    addGap(from, pos - 10 /* LG.SelectionMargin */, line, structure);
                    addGap(pos + 10 /* LG.SelectionMargin */, to, line, structure);
                    return;
                }
            }
            let gap = find(current, gap => gap.from >= line.from && gap.to <= line.to &&
                Math.abs(gap.from - from) < halfMargin && Math.abs(gap.to - to) < halfMargin &&
                !avoid.some(pos => gap.from < pos && gap.to > pos));
            if (!gap) {
                // When scrolling down, snap gap ends to line starts to avoid shifts in wrapping
                if (to < line.to && mayMeasure && wrapping &&
                    mayMeasure.visibleRanges.some(r => r.from <= to && r.to >= to)) {
                    let lineStart = mayMeasure.moveToLineBoundary(EditorSelection.cursor(to), false, true).head;
                    if (lineStart > from)
                        to = lineStart;
                }
                gap = new LineGap(from, to, this.gapSize(line, from, to, structure));
            }
            gaps.push(gap);
        };
        let checkLine = (line) => {
            if (line.length < doubleMargin || line.type != BlockType.Text)
                return;
            let structure = lineStructure(line.from, line.to, this.stateDeco);
            if (structure.total < doubleMargin)
                return;
            let target = this.scrollTarget ? this.scrollTarget.range.head : null;
            let viewFrom, viewTo;
            if (wrapping) {
                let marginHeight = (margin / this.heightOracle.lineLength) * this.heightOracle.lineHeight;
                let top, bot;
                if (target != null) {
                    let targetFrac = findFraction(structure, target);
                    let spaceFrac = ((this.visibleBottom - this.visibleTop) / 2 + marginHeight) / line.height;
                    top = targetFrac - spaceFrac;
                    bot = targetFrac + spaceFrac;
                }
                else {
                    top = (this.visibleTop - line.top - marginHeight) / line.height;
                    bot = (this.visibleBottom - line.top + marginHeight) / line.height;
                }
                viewFrom = findPosition(structure, top);
                viewTo = findPosition(structure, bot);
            }
            else {
                let totalWidth = structure.total * this.heightOracle.charWidth;
                let marginWidth = margin * this.heightOracle.charWidth;
                let left, right;
                if (target != null) {
                    let targetFrac = findFraction(structure, target);
                    let spaceFrac = ((this.pixelViewport.right - this.pixelViewport.left) / 2 + marginWidth) / totalWidth;
                    left = targetFrac - spaceFrac;
                    right = targetFrac + spaceFrac;
                }
                else {
                    left = (this.pixelViewport.left - marginWidth) / totalWidth;
                    right = (this.pixelViewport.right + marginWidth) / totalWidth;
                }
                viewFrom = findPosition(structure, left);
                viewTo = findPosition(structure, right);
            }
            if (viewFrom > line.from)
                addGap(line.from, viewFrom, line, structure);
            if (viewTo < line.to)
                addGap(viewTo, line.to, line, structure);
        };
        for (let line of this.viewportLines) {
            if (Array.isArray(line.type))
                line.type.forEach(checkLine);
            else
                checkLine(line);
        }
        return gaps;
    }
    gapSize(line, from, to, structure) {
        let fraction = findFraction(structure, to) - findFraction(structure, from);
        if (this.heightOracle.lineWrapping) {
            return line.height * fraction;
        }
        else {
            return structure.total * this.heightOracle.charWidth * fraction;
        }
    }
    updateLineGaps(gaps) {
        if (!LineGap.same(gaps, this.lineGaps)) {
            this.lineGaps = gaps;
            this.lineGapDeco = Decoration.set(gaps.map(gap => gap.draw(this, this.heightOracle.lineWrapping)));
        }
    }
    computeVisibleRanges() {
        let deco = this.stateDeco;
        if (this.lineGaps.length)
            deco = deco.concat(this.lineGapDeco);
        let ranges = [];
        RangeSet.spans(deco, this.viewport.from, this.viewport.to, {
            span(from, to) { ranges.push({ from, to }); },
            point() { }
        }, 20);
        let changed = ranges.length != this.visibleRanges.length ||
            this.visibleRanges.some((r, i) => r.from != ranges[i].from || r.to != ranges[i].to);
        this.visibleRanges = ranges;
        return changed ? 4 /* UpdateFlag.Viewport */ : 0;
    }
    lineBlockAt(pos) {
        return (pos >= this.viewport.from && pos <= this.viewport.to &&
            this.viewportLines.find(b => b.from <= pos && b.to >= pos)) ||
            scaleBlock(this.heightMap.lineAt(pos, QueryType.ByPos, this.heightOracle, 0, 0), this.scaler);
    }
    lineBlockAtHeight(height) {
        return (height >= this.viewportLines[0].top && height <= this.viewportLines[this.viewportLines.length - 1].bottom &&
            this.viewportLines.find(l => l.top <= height && l.bottom >= height)) ||
            scaleBlock(this.heightMap.lineAt(this.scaler.fromDOM(height), QueryType.ByHeight, this.heightOracle, 0, 0), this.scaler);
    }
    scrollAnchorAt(scrollTop) {
        let block = this.lineBlockAtHeight(scrollTop + 8);
        return block.from >= this.viewport.from || this.viewportLines[0].top - scrollTop > 200 ? block : this.viewportLines[0];
    }
    elementAtHeight(height) {
        return scaleBlock(this.heightMap.blockAt(this.scaler.fromDOM(height), this.heightOracle, 0, 0), this.scaler);
    }
    get docHeight() {
        return this.scaler.toDOM(this.heightMap.height);
    }
    get contentHeight() {
        return this.docHeight + this.paddingTop + this.paddingBottom;
    }
}
class Viewport {
    constructor(from, to) {
        this.from = from;
        this.to = to;
    }
}
function lineStructure(from, to, stateDeco) {
    let ranges = [], pos = from, total = 0;
    RangeSet.spans(stateDeco, from, to, {
        span() { },
        point(from, to) {
            if (from > pos) {
                ranges.push({ from: pos, to: from });
                total += from - pos;
            }
            pos = to;
        }
    }, 20); // We're only interested in collapsed ranges of a significant size
    if (pos < to) {
        ranges.push({ from: pos, to });
        total += to - pos;
    }
    return { total, ranges };
}
function findPosition({ total, ranges }, ratio) {
    if (ratio <= 0)
        return ranges[0].from;
    if (ratio >= 1)
        return ranges[ranges.length - 1].to;
    let dist = Math.floor(total * ratio);
    for (let i = 0;; i++) {
        let { from, to } = ranges[i], size = to - from;
        if (dist <= size)
            return from + dist;
        dist -= size;
    }
}
function findFraction(structure, pos) {
    let counted = 0;
    for (let { from, to } of structure.ranges) {
        if (pos <= to) {
            counted += pos - from;
            break;
        }
        counted += to - from;
    }
    return counted / structure.total;
}
function find(array, f) {
    for (let val of array)
        if (f(val))
            return val;
    return undefined;
}
// Don't scale when the document height is within the range of what
// the DOM can handle.
const IdScaler = {
    toDOM(n) { return n; },
    fromDOM(n) { return n; },
    scale: 1,
    eq(other) { return other == this; }
};
// When the height is too big (> VP.MaxDOMHeight), scale down the
// regions outside the viewports so that the total height is
// VP.MaxDOMHeight.
class BigScaler {
    constructor(oracle, heightMap, viewports) {
        let vpHeight = 0, base = 0, domBase = 0;
        this.viewports = viewports.map(({ from, to }) => {
            let top = heightMap.lineAt(from, QueryType.ByPos, oracle, 0, 0).top;
            let bottom = heightMap.lineAt(to, QueryType.ByPos, oracle, 0, 0).bottom;
            vpHeight += bottom - top;
            return { from, to, top, bottom, domTop: 0, domBottom: 0 };
        });
        this.scale = (7000000 /* VP.MaxDOMHeight */ - vpHeight) / (heightMap.height - vpHeight);
        for (let obj of this.viewports) {
            obj.domTop = domBase + (obj.top - base) * this.scale;
            domBase = obj.domBottom = obj.domTop + (obj.bottom - obj.top);
            base = obj.bottom;
        }
    }
    toDOM(n) {
        for (let i = 0, base = 0, domBase = 0;; i++) {
            let vp = i < this.viewports.length ? this.viewports[i] : null;
            if (!vp || n < vp.top)
                return domBase + (n - base) * this.scale;
            if (n <= vp.bottom)
                return vp.domTop + (n - vp.top);
            base = vp.bottom;
            domBase = vp.domBottom;
        }
    }
    fromDOM(n) {
        for (let i = 0, base = 0, domBase = 0;; i++) {
            let vp = i < this.viewports.length ? this.viewports[i] : null;
            if (!vp || n < vp.domTop)
                return base + (n - domBase) / this.scale;
            if (n <= vp.domBottom)
                return vp.top + (n - vp.domTop);
            base = vp.bottom;
            domBase = vp.domBottom;
        }
    }
    eq(other) {
        if (!(other instanceof BigScaler))
            return false;
        return this.scale == other.scale && this.viewports.length == other.viewports.length &&
            this.viewports.every((vp, i) => vp.from == other.viewports[i].from && vp.to == other.viewports[i].to);
    }
}
function scaleBlock(block, scaler) {
    if (scaler.scale == 1)
        return block;
    let bTop = scaler.toDOM(block.top), bBottom = scaler.toDOM(block.bottom);
    return new BlockInfo(block.from, block.length, bTop, bBottom - bTop, Array.isArray(block._content) ? block._content.map(b => scaleBlock(b, scaler)) : block._content);
}

const theme = /*@__PURE__*/Facet.define({ combine: strs => strs.join(" ") });
const darkTheme = /*@__PURE__*/Facet.define({ combine: values => values.indexOf(true) > -1 });
const baseThemeID = /*@__PURE__*/StyleModule.newName(), baseLightID = /*@__PURE__*/StyleModule.newName(), baseDarkID = /*@__PURE__*/StyleModule.newName();
const lightDarkIDs = { "&light": "." + baseLightID, "&dark": "." + baseDarkID };
function buildTheme(main, spec, scopes) {
    return new StyleModule(spec, {
        finish(sel) {
            return /&/.test(sel) ? sel.replace(/&\w*/, m => {
                if (m == "&")
                    return main;
                if (!scopes || !scopes[m])
                    throw new RangeError(`Unsupported selector: ${m}`);
                return scopes[m];
            }) : main + " " + sel;
        }
    });
}
const baseTheme$1$1 = /*@__PURE__*/buildTheme("." + baseThemeID, {
    "&": {
        position: "relative !important",
        boxSizing: "border-box",
        "&.cm-focused": {
            // Provide a simple default outline to make sure a focused
            // editor is visually distinct. Can't leave the default behavior
            // because that will apply to the content element, which is
            // inside the scrollable container and doesn't include the
            // gutters. We also can't use an 'auto' outline, since those
            // are, for some reason, drawn behind the element content, which
            // will cause things like the active line background to cover
            // the outline (#297).
            outline: "1px dotted #212121"
        },
        display: "flex !important",
        flexDirection: "column"
    },
    ".cm-scroller": {
        display: "flex !important",
        alignItems: "flex-start !important",
        fontFamily: "monospace",
        lineHeight: 1.4,
        height: "100%",
        overflowX: "auto",
        position: "relative",
        zIndex: 0
    },
    ".cm-content": {
        margin: 0,
        flexGrow: 2,
        flexShrink: 0,
        display: "block",
        whiteSpace: "pre",
        wordWrap: "normal", // https://github.com/codemirror/dev/issues/456
        boxSizing: "border-box",
        minHeight: "100%",
        padding: "4px 0",
        outline: "none",
        "&[contenteditable=true]": {
            WebkitUserModify: "read-write-plaintext-only",
        }
    },
    ".cm-lineWrapping": {
        whiteSpace_fallback: "pre-wrap", // For IE
        whiteSpace: "break-spaces",
        wordBreak: "break-word", // For Safari, which doesn't support overflow-wrap: anywhere
        overflowWrap: "anywhere",
        flexShrink: 1
    },
    "&light .cm-content": { caretColor: "black" },
    "&dark .cm-content": { caretColor: "white" },
    ".cm-line": {
        display: "block",
        padding: "0 2px 0 6px"
    },
    ".cm-layer": {
        position: "absolute",
        left: 0,
        top: 0,
        contain: "size style",
        "& > *": {
            position: "absolute"
        }
    },
    "&light .cm-selectionBackground": {
        background: "#d9d9d9"
    },
    "&dark .cm-selectionBackground": {
        background: "#222"
    },
    "&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
        background: "#d7d4f0"
    },
    "&dark.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
        background: "#233"
    },
    ".cm-cursorLayer": {
        pointerEvents: "none"
    },
    "&.cm-focused > .cm-scroller > .cm-cursorLayer": {
        animation: "steps(1) cm-blink 1.2s infinite"
    },
    // Two animations defined so that we can switch between them to
    // restart the animation without forcing another style
    // recomputation.
    "@keyframes cm-blink": { "0%": {}, "50%": { opacity: 0 }, "100%": {} },
    "@keyframes cm-blink2": { "0%": {}, "50%": { opacity: 0 }, "100%": {} },
    ".cm-cursor, .cm-dropCursor": {
        borderLeft: "1.2px solid black",
        marginLeft: "-0.6px",
        pointerEvents: "none",
    },
    ".cm-cursor": {
        display: "none"
    },
    "&dark .cm-cursor": {
        borderLeftColor: "#444"
    },
    ".cm-dropCursor": {
        position: "absolute"
    },
    "&.cm-focused > .cm-scroller > .cm-cursorLayer .cm-cursor": {
        display: "block"
    },
    ".cm-iso": {
        unicodeBidi: "isolate"
    },
    ".cm-announced": {
        position: "fixed",
        top: "-10000px"
    },
    "@media print": {
        ".cm-announced": { display: "none" }
    },
    "&light .cm-activeLine": { backgroundColor: "#cceeff44" },
    "&dark .cm-activeLine": { backgroundColor: "#99eeff33" },
    "&light .cm-specialChar": { color: "red" },
    "&dark .cm-specialChar": { color: "#f78" },
    ".cm-gutters": {
        flexShrink: 0,
        display: "flex",
        height: "100%",
        boxSizing: "border-box",
        insetInlineStart: 0,
        zIndex: 200
    },
    "&light .cm-gutters": {
        backgroundColor: "#f5f5f5",
        color: "#6c6c6c",
        borderRight: "1px solid #ddd"
    },
    "&dark .cm-gutters": {
        backgroundColor: "#333338",
        color: "#ccc"
    },
    ".cm-gutter": {
        display: "flex !important", // Necessary -- prevents margin collapsing
        flexDirection: "column",
        flexShrink: 0,
        boxSizing: "border-box",
        minHeight: "100%",
        overflow: "hidden"
    },
    ".cm-gutterElement": {
        boxSizing: "border-box"
    },
    ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 3px 0 5px",
        minWidth: "20px",
        textAlign: "right",
        whiteSpace: "nowrap"
    },
    "&light .cm-activeLineGutter": {
        backgroundColor: "#e2f2ff"
    },
    "&dark .cm-activeLineGutter": {
        backgroundColor: "#222227"
    },
    ".cm-panels": {
        boxSizing: "border-box",
        position: "sticky",
        left: 0,
        right: 0
    },
    "&light .cm-panels": {
        backgroundColor: "#f5f5f5",
        color: "black"
    },
    "&light .cm-panels-top": {
        borderBottom: "1px solid #ddd"
    },
    "&light .cm-panels-bottom": {
        borderTop: "1px solid #ddd"
    },
    "&dark .cm-panels": {
        backgroundColor: "#333338",
        color: "white"
    },
    ".cm-tab": {
        display: "inline-block",
        overflow: "hidden",
        verticalAlign: "bottom"
    },
    ".cm-widgetBuffer": {
        verticalAlign: "text-top",
        height: "1em",
        width: 0,
        display: "inline"
    },
    ".cm-placeholder": {
        color: "#888",
        display: "inline-block",
        verticalAlign: "top",
    },
    ".cm-highlightSpace:before": {
        content: "attr(data-display)",
        position: "absolute",
        pointerEvents: "none",
        color: "#888"
    },
    ".cm-highlightTab": {
        backgroundImage: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="20"><path stroke="%23888" stroke-width="1" fill="none" d="M1 10H196L190 5M190 15L196 10M197 4L197 16"/></svg>')`,
        backgroundSize: "auto 100%",
        backgroundPosition: "right 90%",
        backgroundRepeat: "no-repeat"
    },
    ".cm-trailingSpace": {
        backgroundColor: "#ff332255"
    },
    ".cm-button": {
        verticalAlign: "middle",
        color: "inherit",
        fontSize: "70%",
        padding: ".2em 1em",
        borderRadius: "1px"
    },
    "&light .cm-button": {
        backgroundImage: "linear-gradient(#eff1f5, #d9d9df)",
        border: "1px solid #888",
        "&:active": {
            backgroundImage: "linear-gradient(#b4b4b4, #d0d3d6)"
        }
    },
    "&dark .cm-button": {
        backgroundImage: "linear-gradient(#393939, #111)",
        border: "1px solid #888",
        "&:active": {
            backgroundImage: "linear-gradient(#111, #333)"
        }
    },
    ".cm-textfield": {
        verticalAlign: "middle",
        color: "inherit",
        fontSize: "70%",
        border: "1px solid silver",
        padding: ".2em .5em"
    },
    "&light .cm-textfield": {
        backgroundColor: "white"
    },
    "&dark .cm-textfield": {
        border: "1px solid #555",
        backgroundColor: "inherit"
    }
}, lightDarkIDs);

const LineBreakPlaceholder = "\uffff";
class DOMReader {
    constructor(points, state) {
        this.points = points;
        this.text = "";
        this.lineSeparator = state.facet(EditorState.lineSeparator);
    }
    append(text) {
        this.text += text;
    }
    lineBreak() {
        this.text += LineBreakPlaceholder;
    }
    readRange(start, end) {
        if (!start)
            return this;
        let parent = start.parentNode;
        for (let cur = start;;) {
            this.findPointBefore(parent, cur);
            let oldLen = this.text.length;
            this.readNode(cur);
            let next = cur.nextSibling;
            if (next == end)
                break;
            let view = ContentView.get(cur), nextView = ContentView.get(next);
            if (view && nextView ? view.breakAfter :
                (view ? view.breakAfter : isBlockElement(cur)) ||
                    (isBlockElement(next) && (cur.nodeName != "BR" || cur.cmIgnore) && this.text.length > oldLen))
                this.lineBreak();
            cur = next;
        }
        this.findPointBefore(parent, end);
        return this;
    }
    readTextNode(node) {
        let text = node.nodeValue;
        for (let point of this.points)
            if (point.node == node)
                point.pos = this.text.length + Math.min(point.offset, text.length);
        for (let off = 0, re = this.lineSeparator ? null : /\r\n?|\n/g;;) {
            let nextBreak = -1, breakSize = 1, m;
            if (this.lineSeparator) {
                nextBreak = text.indexOf(this.lineSeparator, off);
                breakSize = this.lineSeparator.length;
            }
            else if (m = re.exec(text)) {
                nextBreak = m.index;
                breakSize = m[0].length;
            }
            this.append(text.slice(off, nextBreak < 0 ? text.length : nextBreak));
            if (nextBreak < 0)
                break;
            this.lineBreak();
            if (breakSize > 1)
                for (let point of this.points)
                    if (point.node == node && point.pos > this.text.length)
                        point.pos -= breakSize - 1;
            off = nextBreak + breakSize;
        }
    }
    readNode(node) {
        if (node.cmIgnore)
            return;
        let view = ContentView.get(node);
        let fromView = view && view.overrideDOMText;
        if (fromView != null) {
            this.findPointInside(node, fromView.length);
            for (let i = fromView.iter(); !i.next().done;) {
                if (i.lineBreak)
                    this.lineBreak();
                else
                    this.append(i.value);
            }
        }
        else if (node.nodeType == 3) {
            this.readTextNode(node);
        }
        else if (node.nodeName == "BR") {
            if (node.nextSibling)
                this.lineBreak();
        }
        else if (node.nodeType == 1) {
            this.readRange(node.firstChild, null);
        }
    }
    findPointBefore(node, next) {
        for (let point of this.points)
            if (point.node == node && node.childNodes[point.offset] == next)
                point.pos = this.text.length;
    }
    findPointInside(node, length) {
        for (let point of this.points)
            if (node.nodeType == 3 ? point.node == node : node.contains(point.node))
                point.pos = this.text.length + (isAtEnd(node, point.node, point.offset) ? length : 0);
    }
}
function isAtEnd(parent, node, offset) {
    for (;;) {
        if (!node || offset < maxOffset(node))
            return false;
        if (node == parent)
            return true;
        offset = domIndex(node) + 1;
        node = node.parentNode;
    }
}
class DOMPoint {
    constructor(node, offset) {
        this.node = node;
        this.offset = offset;
        this.pos = -1;
    }
}

class DOMChange {
    constructor(view, start, end, typeOver) {
        this.typeOver = typeOver;
        this.bounds = null;
        this.text = "";
        this.domChanged = start > -1;
        let { impreciseHead: iHead, impreciseAnchor: iAnchor } = view.docView;
        if (view.state.readOnly && start > -1) {
            // Ignore changes when the editor is read-only
            this.newSel = null;
        }
        else if (start > -1 && (this.bounds = view.docView.domBoundsAround(start, end, 0))) {
            let selPoints = iHead || iAnchor ? [] : selectionPoints(view);
            let reader = new DOMReader(selPoints, view.state);
            reader.readRange(this.bounds.startDOM, this.bounds.endDOM);
            this.text = reader.text;
            this.newSel = selectionFromPoints(selPoints, this.bounds.from);
        }
        else {
            let domSel = view.observer.selectionRange;
            let head = iHead && iHead.node == domSel.focusNode && iHead.offset == domSel.focusOffset ||
                !contains(view.contentDOM, domSel.focusNode)
                ? view.state.selection.main.head
                : view.docView.posFromDOM(domSel.focusNode, domSel.focusOffset);
            let anchor = iAnchor && iAnchor.node == domSel.anchorNode && iAnchor.offset == domSel.anchorOffset ||
                !contains(view.contentDOM, domSel.anchorNode)
                ? view.state.selection.main.anchor
                : view.docView.posFromDOM(domSel.anchorNode, domSel.anchorOffset);
            // iOS will refuse to select the block gaps when doing
            // select-all.
            // Chrome will put the selection *inside* them, confusing
            // posFromDOM
            let vp = view.viewport;
            if ((browser.ios || browser.chrome) && view.state.selection.main.empty && head != anchor &&
                (vp.from > 0 || vp.to < view.state.doc.length)) {
                let from = Math.min(head, anchor), to = Math.max(head, anchor);
                let offFrom = vp.from - from, offTo = vp.to - to;
                if ((offFrom == 0 || offFrom == 1 || from == 0) && (offTo == 0 || offTo == -1 || to == view.state.doc.length)) {
                    head = 0;
                    anchor = view.state.doc.length;
                }
            }
            this.newSel = EditorSelection.single(anchor, head);
        }
    }
}
function applyDOMChange(view, domChange) {
    let change;
    let { newSel } = domChange, sel = view.state.selection.main;
    let lastKey = view.inputState.lastKeyTime > Date.now() - 100 ? view.inputState.lastKeyCode : -1;
    if (domChange.bounds) {
        let { from, to } = domChange.bounds;
        let preferredPos = sel.from, preferredSide = null;
        // Prefer anchoring to end when Backspace is pressed (or, on
        // Android, when something was deleted)
        if (lastKey === 8 || browser.android && domChange.text.length < to - from) {
            preferredPos = sel.to;
            preferredSide = "end";
        }
        let diff = findDiff(view.state.doc.sliceString(from, to, LineBreakPlaceholder), domChange.text, preferredPos - from, preferredSide);
        if (diff) {
            // Chrome inserts two newlines when pressing shift-enter at the
            // end of a line. DomChange drops one of those.
            if (browser.chrome && lastKey == 13 &&
                diff.toB == diff.from + 2 && domChange.text.slice(diff.from, diff.toB) == LineBreakPlaceholder + LineBreakPlaceholder)
                diff.toB--;
            change = { from: from + diff.from, to: from + diff.toA,
                insert: Text.of(domChange.text.slice(diff.from, diff.toB).split(LineBreakPlaceholder)) };
        }
    }
    else if (newSel && (!view.hasFocus && view.state.facet(editable) || newSel.main.eq(sel))) {
        newSel = null;
    }
    if (!change && !newSel)
        return false;
    if (!change && domChange.typeOver && !sel.empty && newSel && newSel.main.empty) {
        // Heuristic to notice typing over a selected character
        change = { from: sel.from, to: sel.to, insert: view.state.doc.slice(sel.from, sel.to) };
    }
    else if (change && change.from >= sel.from && change.to <= sel.to &&
        (change.from != sel.from || change.to != sel.to) &&
        (sel.to - sel.from) - (change.to - change.from) <= 4) {
        // If the change is inside the selection and covers most of it,
        // assume it is a selection replace (with identical characters at
        // the start/end not included in the diff)
        change = {
            from: sel.from, to: sel.to,
            insert: view.state.doc.slice(sel.from, change.from).append(change.insert).append(view.state.doc.slice(change.to, sel.to))
        };
    }
    else if ((browser.mac || browser.android) && change && change.from == change.to && change.from == sel.head - 1 &&
        /^\. ?$/.test(change.insert.toString()) && view.contentDOM.getAttribute("autocorrect") == "off") {
        // Detect insert-period-on-double-space Mac and Android behavior,
        // and transform it into a regular space insert.
        if (newSel && change.insert.length == 2)
            newSel = EditorSelection.single(newSel.main.anchor - 1, newSel.main.head - 1);
        change = { from: sel.from, to: sel.to, insert: Text.of([" "]) };
    }
    else if (browser.chrome && change && change.from == change.to && change.from == sel.head &&
        change.insert.toString() == "\n " && view.lineWrapping) {
        // In Chrome, if you insert a space at the start of a wrapped
        // line, it will actually insert a newline and a space, causing a
        // bogus new line to be created in CodeMirror (#968)
        if (newSel)
            newSel = EditorSelection.single(newSel.main.anchor - 1, newSel.main.head - 1);
        change = { from: sel.from, to: sel.to, insert: Text.of([" "]) };
    }
    if (change) {
        return applyDOMChangeInner(view, change, newSel, lastKey);
    }
    else if (newSel && !newSel.main.eq(sel)) {
        let scrollIntoView = false, userEvent = "select";
        if (view.inputState.lastSelectionTime > Date.now() - 50) {
            if (view.inputState.lastSelectionOrigin == "select")
                scrollIntoView = true;
            userEvent = view.inputState.lastSelectionOrigin;
        }
        view.dispatch({ selection: newSel, scrollIntoView, userEvent });
        return true;
    }
    else {
        return false;
    }
}
function applyDOMChangeInner(view, change, newSel, lastKey = -1) {
    if (browser.ios && view.inputState.flushIOSKey(change))
        return true;
    let sel = view.state.selection.main;
    // Android browsers don't fire reasonable key events for enter,
    // backspace, or delete. So this detects changes that look like
    // they're caused by those keys, and reinterprets them as key
    // events. (Some of these keys are also handled by beforeinput
    // events and the pendingAndroidKey mechanism, but that's not
    // reliable in all situations.)
    if (browser.android &&
        ((change.to == sel.to &&
            // GBoard will sometimes remove a space it just inserted
            // after a completion when you press enter
            (change.from == sel.from || change.from == sel.from - 1 && view.state.sliceDoc(change.from, sel.from) == " ") &&
            change.insert.length == 1 && change.insert.lines == 2 &&
            dispatchKey(view.contentDOM, "Enter", 13)) ||
            ((change.from == sel.from - 1 && change.to == sel.to && change.insert.length == 0 ||
                lastKey == 8 && change.insert.length < change.to - change.from && change.to > sel.head) &&
                dispatchKey(view.contentDOM, "Backspace", 8)) ||
            (change.from == sel.from && change.to == sel.to + 1 && change.insert.length == 0 &&
                dispatchKey(view.contentDOM, "Delete", 46))))
        return true;
    let text = change.insert.toString();
    if (view.inputState.composing >= 0)
        view.inputState.composing++;
    let defaultTr;
    let defaultInsert = () => defaultTr || (defaultTr = applyDefaultInsert(view, change, newSel));
    if (!view.state.facet(inputHandler).some(h => h(view, change.from, change.to, text, defaultInsert)))
        view.dispatch(defaultInsert());
    return true;
}
function applyDefaultInsert(view, change, newSel) {
    let tr, startState = view.state, sel = startState.selection.main;
    if (change.from >= sel.from && change.to <= sel.to && change.to - change.from >= (sel.to - sel.from) / 3 &&
        (!newSel || newSel.main.empty && newSel.main.from == change.from + change.insert.length) &&
        view.inputState.composing < 0) {
        let before = sel.from < change.from ? startState.sliceDoc(sel.from, change.from) : "";
        let after = sel.to > change.to ? startState.sliceDoc(change.to, sel.to) : "";
        tr = startState.replaceSelection(view.state.toText(before + change.insert.sliceString(0, undefined, view.state.lineBreak) + after));
    }
    else {
        let changes = startState.changes(change);
        let mainSel = newSel && newSel.main.to <= changes.newLength ? newSel.main : undefined;
        // Try to apply a composition change to all cursors
        if (startState.selection.ranges.length > 1 && view.inputState.composing >= 0 &&
            change.to <= sel.to && change.to >= sel.to - 10) {
            let replaced = view.state.sliceDoc(change.from, change.to);
            let compositionRange, composition = newSel && findCompositionNode(view, newSel.main.head);
            if (composition) {
                let dLen = change.insert.length - (change.to - change.from);
                compositionRange = { from: composition.from, to: composition.to - dLen };
            }
            else {
                compositionRange = view.state.doc.lineAt(sel.head);
            }
            let offset = sel.to - change.to, size = sel.to - sel.from;
            tr = startState.changeByRange(range => {
                if (range.from == sel.from && range.to == sel.to)
                    return { changes, range: mainSel || range.map(changes) };
                let to = range.to - offset, from = to - replaced.length;
                if (range.to - range.from != size || view.state.sliceDoc(from, to) != replaced ||
                    // Unfortunately, there's no way to make multiple
                    // changes in the same node work without aborting
                    // composition, so cursors in the composition range are
                    // ignored.
                    range.to >= compositionRange.from && range.from <= compositionRange.to)
                    return { range };
                let rangeChanges = startState.changes({ from, to, insert: change.insert }), selOff = range.to - sel.to;
                return {
                    changes: rangeChanges,
                    range: !mainSel ? range.map(rangeChanges) :
                        EditorSelection.range(Math.max(0, mainSel.anchor + selOff), Math.max(0, mainSel.head + selOff))
                };
            });
        }
        else {
            tr = {
                changes,
                selection: mainSel && startState.selection.replaceRange(mainSel)
            };
        }
    }
    let userEvent = "input.type";
    if (view.composing ||
        view.inputState.compositionPendingChange && view.inputState.compositionEndedAt > Date.now() - 50) {
        view.inputState.compositionPendingChange = false;
        userEvent += ".compose";
        if (view.inputState.compositionFirstChange) {
            userEvent += ".start";
            view.inputState.compositionFirstChange = false;
        }
    }
    return startState.update(tr, { userEvent, scrollIntoView: true });
}
function findDiff(a, b, preferredPos, preferredSide) {
    let minLen = Math.min(a.length, b.length);
    let from = 0;
    while (from < minLen && a.charCodeAt(from) == b.charCodeAt(from))
        from++;
    if (from == minLen && a.length == b.length)
        return null;
    let toA = a.length, toB = b.length;
    while (toA > 0 && toB > 0 && a.charCodeAt(toA - 1) == b.charCodeAt(toB - 1)) {
        toA--;
        toB--;
    }
    if (preferredSide == "end") {
        let adjust = Math.max(0, from - Math.min(toA, toB));
        preferredPos -= toA + adjust - from;
    }
    if (toA < from && a.length < b.length) {
        let move = preferredPos <= from && preferredPos >= toA ? from - preferredPos : 0;
        from -= move;
        toB = from + (toB - toA);
        toA = from;
    }
    else if (toB < from) {
        let move = preferredPos <= from && preferredPos >= toB ? from - preferredPos : 0;
        from -= move;
        toA = from + (toA - toB);
        toB = from;
    }
    return { from, toA, toB };
}
function selectionPoints(view) {
    let result = [];
    if (view.root.activeElement != view.contentDOM)
        return result;
    let { anchorNode, anchorOffset, focusNode, focusOffset } = view.observer.selectionRange;
    if (anchorNode) {
        result.push(new DOMPoint(anchorNode, anchorOffset));
        if (focusNode != anchorNode || focusOffset != anchorOffset)
            result.push(new DOMPoint(focusNode, focusOffset));
    }
    return result;
}
function selectionFromPoints(points, base) {
    if (points.length == 0)
        return null;
    let anchor = points[0].pos, head = points.length == 2 ? points[1].pos : anchor;
    return anchor > -1 && head > -1 ? EditorSelection.single(anchor + base, head + base) : null;
}

const observeOptions = {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    characterDataOldValue: true
};
// IE11 has very broken mutation observers, so we also listen to
// DOMCharacterDataModified there
const useCharData = browser.ie && browser.ie_version <= 11;
class DOMObserver {
    constructor(view) {
        this.view = view;
        this.active = false;
        this.editContext = null;
        // The known selection. Kept in our own object, as opposed to just
        // directly accessing the selection because:
        //  - Safari doesn't report the right selection in shadow DOM
        //  - Reading from the selection forces a DOM layout
        //  - This way, we can ignore selectionchange events if we have
        //    already seen the 'new' selection
        this.selectionRange = new DOMSelectionState;
        // Set when a selection change is detected, cleared on flush
        this.selectionChanged = false;
        this.delayedFlush = -1;
        this.resizeTimeout = -1;
        this.queue = [];
        this.delayedAndroidKey = null;
        this.flushingAndroidKey = -1;
        this.lastChange = 0;
        this.scrollTargets = [];
        this.intersection = null;
        this.resizeScroll = null;
        this.intersecting = false;
        this.gapIntersection = null;
        this.gaps = [];
        this.printQuery = null;
        // Timeout for scheduling check of the parents that need scroll handlers
        this.parentCheck = -1;
        this.dom = view.contentDOM;
        this.observer = new MutationObserver(mutations => {
            for (let mut of mutations)
                this.queue.push(mut);
            // IE11 will sometimes (on typing over a selection or
            // backspacing out a single character text node) call the
            // observer callback before actually updating the DOM.
            //
            // Unrelatedly, iOS Safari will, when ending a composition,
            // sometimes first clear it, deliver the mutations, and then
            // reinsert the finished text. CodeMirror's handling of the
            // deletion will prevent the reinsertion from happening,
            // breaking composition.
            if ((browser.ie && browser.ie_version <= 11 || browser.ios && view.composing) &&
                mutations.some(m => m.type == "childList" && m.removedNodes.length ||
                    m.type == "characterData" && m.oldValue.length > m.target.nodeValue.length))
                this.flushSoon();
            else
                this.flush();
        });
        if (window.EditContext && view.constructor.EDIT_CONTEXT !== false &&
            // Chrome <126 doesn't support inverted selections in edit context (#1392)
            !(browser.chrome && browser.chrome_version < 126)) {
            this.editContext = new EditContextManager(view);
            if (view.state.facet(editable))
                view.contentDOM.editContext = this.editContext.editContext;
        }
        if (useCharData)
            this.onCharData = (event) => {
                this.queue.push({ target: event.target,
                    type: "characterData",
                    oldValue: event.prevValue });
                this.flushSoon();
            };
        this.onSelectionChange = this.onSelectionChange.bind(this);
        this.onResize = this.onResize.bind(this);
        this.onPrint = this.onPrint.bind(this);
        this.onScroll = this.onScroll.bind(this);
        if (window.matchMedia)
            this.printQuery = window.matchMedia("print");
        if (typeof ResizeObserver == "function") {
            this.resizeScroll = new ResizeObserver(() => {
                var _a;
                if (((_a = this.view.docView) === null || _a === void 0 ? void 0 : _a.lastUpdate) < Date.now() - 75)
                    this.onResize();
            });
            this.resizeScroll.observe(view.scrollDOM);
        }
        this.addWindowListeners(this.win = view.win);
        this.start();
        if (typeof IntersectionObserver == "function") {
            this.intersection = new IntersectionObserver(entries => {
                if (this.parentCheck < 0)
                    this.parentCheck = setTimeout(this.listenForScroll.bind(this), 1000);
                if (entries.length > 0 && (entries[entries.length - 1].intersectionRatio > 0) != this.intersecting) {
                    this.intersecting = !this.intersecting;
                    if (this.intersecting != this.view.inView)
                        this.onScrollChanged(document.createEvent("Event"));
                }
            }, { threshold: [0, .001] });
            this.intersection.observe(this.dom);
            this.gapIntersection = new IntersectionObserver(entries => {
                if (entries.length > 0 && entries[entries.length - 1].intersectionRatio > 0)
                    this.onScrollChanged(document.createEvent("Event"));
            }, {});
        }
        this.listenForScroll();
        this.readSelectionRange();
    }
    onScrollChanged(e) {
        this.view.inputState.runHandlers("scroll", e);
        if (this.intersecting)
            this.view.measure();
    }
    onScroll(e) {
        if (this.intersecting)
            this.flush(false);
        if (this.editContext)
            this.view.requestMeasure(this.editContext.measureReq);
        this.onScrollChanged(e);
    }
    onResize() {
        if (this.resizeTimeout < 0)
            this.resizeTimeout = setTimeout(() => {
                this.resizeTimeout = -1;
                this.view.requestMeasure();
            }, 50);
    }
    onPrint(event) {
        if (event.type == "change" && !event.matches)
            return;
        this.view.viewState.printing = true;
        this.view.measure();
        setTimeout(() => {
            this.view.viewState.printing = false;
            this.view.requestMeasure();
        }, 500);
    }
    updateGaps(gaps) {
        if (this.gapIntersection && (gaps.length != this.gaps.length || this.gaps.some((g, i) => g != gaps[i]))) {
            this.gapIntersection.disconnect();
            for (let gap of gaps)
                this.gapIntersection.observe(gap);
            this.gaps = gaps;
        }
    }
    onSelectionChange(event) {
        let wasChanged = this.selectionChanged;
        if (!this.readSelectionRange() || this.delayedAndroidKey)
            return;
        let { view } = this, sel = this.selectionRange;
        if (view.state.facet(editable) ? view.root.activeElement != this.dom : !hasSelection(view.dom, sel))
            return;
        let context = sel.anchorNode && view.docView.nearest(sel.anchorNode);
        if (context && context.ignoreEvent(event)) {
            if (!wasChanged)
                this.selectionChanged = false;
            return;
        }
        // Deletions on IE11 fire their events in the wrong order, giving
        // us a selection change event before the DOM changes are
        // reported.
        // Chrome Android has a similar issue when backspacing out a
        // selection (#645).
        if ((browser.ie && browser.ie_version <= 11 || browser.android && browser.chrome) && !view.state.selection.main.empty &&
            // (Selection.isCollapsed isn't reliable on IE)
            sel.focusNode && isEquivalentPosition(sel.focusNode, sel.focusOffset, sel.anchorNode, sel.anchorOffset))
            this.flushSoon();
        else
            this.flush(false);
    }
    readSelectionRange() {
        let { view } = this;
        // The Selection object is broken in shadow roots in Safari. See
        // https://github.com/codemirror/dev/issues/414
        let selection = getSelection(view.root);
        if (!selection)
            return false;
        let range = browser.safari && view.root.nodeType == 11 &&
            deepActiveElement(this.dom.ownerDocument) == this.dom &&
            safariSelectionRangeHack(this.view, selection) || selection;
        if (!range || this.selectionRange.eq(range))
            return false;
        let local = hasSelection(this.dom, range);
        // Detect the situation where the browser has, on focus, moved the
        // selection to the start of the content element. Reset it to the
        // position from the editor state.
        if (local && !this.selectionChanged &&
            view.inputState.lastFocusTime > Date.now() - 200 &&
            view.inputState.lastTouchTime < Date.now() - 300 &&
            atElementStart(this.dom, range)) {
            this.view.inputState.lastFocusTime = 0;
            view.docView.updateSelection();
            return false;
        }
        this.selectionRange.setRange(range);
        if (local)
            this.selectionChanged = true;
        return true;
    }
    setSelectionRange(anchor, head) {
        this.selectionRange.set(anchor.node, anchor.offset, head.node, head.offset);
        this.selectionChanged = false;
    }
    clearSelectionRange() {
        this.selectionRange.set(null, 0, null, 0);
    }
    listenForScroll() {
        this.parentCheck = -1;
        let i = 0, changed = null;
        for (let dom = this.dom; dom;) {
            if (dom.nodeType == 1) {
                if (!changed && i < this.scrollTargets.length && this.scrollTargets[i] == dom)
                    i++;
                else if (!changed)
                    changed = this.scrollTargets.slice(0, i);
                if (changed)
                    changed.push(dom);
                dom = dom.assignedSlot || dom.parentNode;
            }
            else if (dom.nodeType == 11) { // Shadow root
                dom = dom.host;
            }
            else {
                break;
            }
        }
        if (i < this.scrollTargets.length && !changed)
            changed = this.scrollTargets.slice(0, i);
        if (changed) {
            for (let dom of this.scrollTargets)
                dom.removeEventListener("scroll", this.onScroll);
            for (let dom of this.scrollTargets = changed)
                dom.addEventListener("scroll", this.onScroll);
        }
    }
    ignore(f) {
        if (!this.active)
            return f();
        try {
            this.stop();
            return f();
        }
        finally {
            this.start();
            this.clear();
        }
    }
    start() {
        if (this.active)
            return;
        this.observer.observe(this.dom, observeOptions);
        if (useCharData)
            this.dom.addEventListener("DOMCharacterDataModified", this.onCharData);
        this.active = true;
    }
    stop() {
        if (!this.active)
            return;
        this.active = false;
        this.observer.disconnect();
        if (useCharData)
            this.dom.removeEventListener("DOMCharacterDataModified", this.onCharData);
    }
    // Throw away any pending changes
    clear() {
        this.processRecords();
        this.queue.length = 0;
        this.selectionChanged = false;
    }
    // Chrome Android, especially in combination with GBoard, not only
    // doesn't reliably fire regular key events, but also often
    // surrounds the effect of enter or backspace with a bunch of
    // composition events that, when interrupted, cause text duplication
    // or other kinds of corruption. This hack makes the editor back off
    // from handling DOM changes for a moment when such a key is
    // detected (via beforeinput or keydown), and then tries to flush
    // them or, if that has no effect, dispatches the given key.
    delayAndroidKey(key, keyCode) {
        var _a;
        if (!this.delayedAndroidKey) {
            let flush = () => {
                let key = this.delayedAndroidKey;
                if (key) {
                    this.clearDelayedAndroidKey();
                    this.view.inputState.lastKeyCode = key.keyCode;
                    this.view.inputState.lastKeyTime = Date.now();
                    let flushed = this.flush();
                    if (!flushed && key.force)
                        dispatchKey(this.dom, key.key, key.keyCode);
                }
            };
            this.flushingAndroidKey = this.view.win.requestAnimationFrame(flush);
        }
        // Since backspace beforeinput is sometimes signalled spuriously,
        // Enter always takes precedence.
        if (!this.delayedAndroidKey || key == "Enter")
            this.delayedAndroidKey = {
                key, keyCode,
                // Only run the key handler when no changes are detected if
                // this isn't coming right after another change, in which case
                // it is probably part of a weird chain of updates, and should
                // be ignored if it returns the DOM to its previous state.
                force: this.lastChange < Date.now() - 50 || !!((_a = this.delayedAndroidKey) === null || _a === void 0 ? void 0 : _a.force)
            };
    }
    clearDelayedAndroidKey() {
        this.win.cancelAnimationFrame(this.flushingAndroidKey);
        this.delayedAndroidKey = null;
        this.flushingAndroidKey = -1;
    }
    flushSoon() {
        if (this.delayedFlush < 0)
            this.delayedFlush = this.view.win.requestAnimationFrame(() => { this.delayedFlush = -1; this.flush(); });
    }
    forceFlush() {
        if (this.delayedFlush >= 0) {
            this.view.win.cancelAnimationFrame(this.delayedFlush);
            this.delayedFlush = -1;
        }
        this.flush();
    }
    pendingRecords() {
        for (let mut of this.observer.takeRecords())
            this.queue.push(mut);
        return this.queue;
    }
    processRecords() {
        let records = this.pendingRecords();
        if (records.length)
            this.queue = [];
        let from = -1, to = -1, typeOver = false;
        for (let record of records) {
            let range = this.readMutation(record);
            if (!range)
                continue;
            if (range.typeOver)
                typeOver = true;
            if (from == -1) {
                ({ from, to } = range);
            }
            else {
                from = Math.min(range.from, from);
                to = Math.max(range.to, to);
            }
        }
        return { from, to, typeOver };
    }
    readChange() {
        let { from, to, typeOver } = this.processRecords();
        let newSel = this.selectionChanged && hasSelection(this.dom, this.selectionRange);
        if (from < 0 && !newSel)
            return null;
        if (from > -1)
            this.lastChange = Date.now();
        this.view.inputState.lastFocusTime = 0;
        this.selectionChanged = false;
        let change = new DOMChange(this.view, from, to, typeOver);
        this.view.docView.domChanged = { newSel: change.newSel ? change.newSel.main : null };
        return change;
    }
    // Apply pending changes, if any
    flush(readSelection = true) {
        // Completely hold off flushing when pending keys are set—the code
        // managing those will make sure processRecords is called and the
        // view is resynchronized after
        if (this.delayedFlush >= 0 || this.delayedAndroidKey)
            return false;
        if (readSelection)
            this.readSelectionRange();
        let domChange = this.readChange();
        if (!domChange) {
            this.view.requestMeasure();
            return false;
        }
        let startState = this.view.state;
        let handled = applyDOMChange(this.view, domChange);
        // The view wasn't updated but DOM/selection changes were seen. Reset the view.
        if (this.view.state == startState &&
            (domChange.domChanged || domChange.newSel && !domChange.newSel.main.eq(this.view.state.selection.main)))
            this.view.update([]);
        return handled;
    }
    readMutation(rec) {
        let cView = this.view.docView.nearest(rec.target);
        if (!cView || cView.ignoreMutation(rec))
            return null;
        cView.markDirty(rec.type == "attributes");
        if (rec.type == "attributes")
            cView.flags |= 4 /* ViewFlag.AttrsDirty */;
        if (rec.type == "childList") {
            let childBefore = findChild(cView, rec.previousSibling || rec.target.previousSibling, -1);
            let childAfter = findChild(cView, rec.nextSibling || rec.target.nextSibling, 1);
            return { from: childBefore ? cView.posAfter(childBefore) : cView.posAtStart,
                to: childAfter ? cView.posBefore(childAfter) : cView.posAtEnd, typeOver: false };
        }
        else if (rec.type == "characterData") {
            return { from: cView.posAtStart, to: cView.posAtEnd, typeOver: rec.target.nodeValue == rec.oldValue };
        }
        else {
            return null;
        }
    }
    setWindow(win) {
        if (win != this.win) {
            this.removeWindowListeners(this.win);
            this.win = win;
            this.addWindowListeners(this.win);
        }
    }
    addWindowListeners(win) {
        win.addEventListener("resize", this.onResize);
        if (this.printQuery)
            this.printQuery.addEventListener("change", this.onPrint);
        else
            win.addEventListener("beforeprint", this.onPrint);
        win.addEventListener("scroll", this.onScroll);
        win.document.addEventListener("selectionchange", this.onSelectionChange);
    }
    removeWindowListeners(win) {
        win.removeEventListener("scroll", this.onScroll);
        win.removeEventListener("resize", this.onResize);
        if (this.printQuery)
            this.printQuery.removeEventListener("change", this.onPrint);
        else
            win.removeEventListener("beforeprint", this.onPrint);
        win.document.removeEventListener("selectionchange", this.onSelectionChange);
    }
    update(update) {
        if (this.editContext) {
            this.editContext.update(update);
            if (update.startState.facet(editable) != update.state.facet(editable))
                update.view.contentDOM.editContext = update.state.facet(editable) ? this.editContext.editContext : null;
        }
    }
    destroy() {
        var _a, _b, _c;
        this.stop();
        (_a = this.intersection) === null || _a === void 0 ? void 0 : _a.disconnect();
        (_b = this.gapIntersection) === null || _b === void 0 ? void 0 : _b.disconnect();
        (_c = this.resizeScroll) === null || _c === void 0 ? void 0 : _c.disconnect();
        for (let dom of this.scrollTargets)
            dom.removeEventListener("scroll", this.onScroll);
        this.removeWindowListeners(this.win);
        clearTimeout(this.parentCheck);
        clearTimeout(this.resizeTimeout);
        this.win.cancelAnimationFrame(this.delayedFlush);
        this.win.cancelAnimationFrame(this.flushingAndroidKey);
        if (this.editContext) {
            this.view.contentDOM.editContext = null;
            this.editContext.destroy();
        }
    }
}
function findChild(cView, dom, dir) {
    while (dom) {
        let curView = ContentView.get(dom);
        if (curView && curView.parent == cView)
            return curView;
        let parent = dom.parentNode;
        dom = parent != cView.dom ? parent : dir > 0 ? dom.nextSibling : dom.previousSibling;
    }
    return null;
}
function buildSelectionRangeFromRange(view, range) {
    let anchorNode = range.startContainer, anchorOffset = range.startOffset;
    let focusNode = range.endContainer, focusOffset = range.endOffset;
    let curAnchor = view.docView.domAtPos(view.state.selection.main.anchor);
    // Since such a range doesn't distinguish between anchor and head,
    // use a heuristic that flips it around if its end matches the
    // current anchor.
    if (isEquivalentPosition(curAnchor.node, curAnchor.offset, focusNode, focusOffset))
        [anchorNode, anchorOffset, focusNode, focusOffset] = [focusNode, focusOffset, anchorNode, anchorOffset];
    return { anchorNode, anchorOffset, focusNode, focusOffset };
}
// Used to work around a Safari Selection/shadow DOM bug (#414)
function safariSelectionRangeHack(view, selection) {
    if (selection.getComposedRanges) {
        let range = selection.getComposedRanges(view.root)[0];
        if (range)
            return buildSelectionRangeFromRange(view, range);
    }
    let found = null;
    // Because Safari (at least in 2018-2021) doesn't provide regular
    // access to the selection inside a shadowroot, we have to perform a
    // ridiculous hack to get at it—using `execCommand` to trigger a
    // `beforeInput` event so that we can read the target range from the
    // event.
    function read(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        found = event.getTargetRanges()[0];
    }
    view.contentDOM.addEventListener("beforeinput", read, true);
    view.dom.ownerDocument.execCommand("indent");
    view.contentDOM.removeEventListener("beforeinput", read, true);
    return found ? buildSelectionRangeFromRange(view, found) : null;
}
class EditContextManager {
    constructor(view) {
        // The document window for which the text in the context is
        // maintained. For large documents, this may be smaller than the
        // editor document. This window always includes the selection head.
        this.from = 0;
        this.to = 0;
        // When applying a transaction, this is used to compare the change
        // made to the context content to the change in the transaction in
        // order to make the minimal changes to the context (since touching
        // that sometimes breaks series of multiple edits made for a single
        // user action on some Android keyboards)
        this.pendingContextChange = null;
        this.handlers = Object.create(null);
        this.resetRange(view.state);
        let context = this.editContext = new window.EditContext({
            text: view.state.doc.sliceString(this.from, this.to),
            selectionStart: this.toContextPos(Math.max(this.from, Math.min(this.to, view.state.selection.main.anchor))),
            selectionEnd: this.toContextPos(view.state.selection.main.head)
        });
        this.handlers.textupdate = e => {
            let { anchor } = view.state.selection.main;
            let change = { from: this.toEditorPos(e.updateRangeStart),
                to: this.toEditorPos(e.updateRangeEnd),
                insert: Text.of(e.text.split("\n")) };
            // If the window doesn't include the anchor, assume changes
            // adjacent to a side go up to the anchor.
            if (change.from == this.from && anchor < this.from)
                change.from = anchor;
            else if (change.to == this.to && anchor > this.to)
                change.to = anchor;
            // Edit contexts sometimes fire empty changes
            if (change.from == change.to && !change.insert.length)
                return;
            this.pendingContextChange = change;
            applyDOMChangeInner(view, change, EditorSelection.single(this.toEditorPos(e.selectionStart), this.toEditorPos(e.selectionEnd)));
            // If the transaction didn't flush our change, revert it so
            // that the context is in sync with the editor state again.
            if (this.pendingContextChange) {
                this.revertPending(view.state);
                this.setSelection(view.state);
            }
        };
        this.handlers.characterboundsupdate = e => {
            let rects = [], prev = null;
            for (let i = this.toEditorPos(e.rangeStart), end = this.toEditorPos(e.rangeEnd); i < end; i++) {
                let rect = view.coordsForChar(i);
                prev = (rect && new DOMRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top))
                    || prev || new DOMRect;
                rects.push(prev);
            }
            context.updateCharacterBounds(e.rangeStart, rects);
        };
        this.handlers.textformatupdate = e => {
            let deco = [];
            for (let format of e.getTextFormats()) {
                let lineStyle = format.underlineStyle, thickness = format.underlineThickness;
                if (lineStyle != "None" && thickness != "None") {
                    let style = `text-decoration: underline ${lineStyle == "Dashed" ? "dashed " : lineStyle == "Squiggle" ? "wavy " : ""}${thickness == "Thin" ? 1 : 2}px`;
                    deco.push(Decoration.mark({ attributes: { style } })
                        .range(this.toEditorPos(format.rangeStart), this.toEditorPos(format.rangeEnd)));
                }
            }
            view.dispatch({ effects: setEditContextFormatting.of(Decoration.set(deco)) });
        };
        this.handlers.compositionstart = () => {
            if (view.inputState.composing < 0) {
                view.inputState.composing = 0;
                view.inputState.compositionFirstChange = true;
            }
        };
        this.handlers.compositionend = () => {
            view.inputState.composing = -1;
            view.inputState.compositionFirstChange = null;
        };
        for (let event in this.handlers)
            context.addEventListener(event, this.handlers[event]);
        this.measureReq = { read: view => {
                this.editContext.updateControlBounds(view.contentDOM.getBoundingClientRect());
                let sel = getSelection(view.root);
                if (sel && sel.rangeCount)
                    this.editContext.updateSelectionBounds(sel.getRangeAt(0).getBoundingClientRect());
            } };
    }
    applyEdits(update) {
        let off = 0, abort = false, pending = this.pendingContextChange;
        update.changes.iterChanges((fromA, toA, _fromB, _toB, insert) => {
            if (abort)
                return;
            let dLen = insert.length - (toA - fromA);
            if (pending && toA >= pending.to) {
                if (pending.from == fromA && pending.to == toA && pending.insert.eq(insert)) {
                    pending = this.pendingContextChange = null; // Match
                    off += dLen;
                    this.to += dLen;
                    return;
                }
                else { // Mismatch, revert
                    pending = null;
                    this.revertPending(update.state);
                }
            }
            fromA += off;
            toA += off;
            if (toA <= this.from) { // Before the window
                this.from += dLen;
                this.to += dLen;
            }
            else if (fromA < this.to) { // Overlaps with window
                if (fromA < this.from || toA > this.to || (this.to - this.from) + insert.length > 30000 /* CxVp.MaxSize */) {
                    abort = true;
                    return;
                }
                this.editContext.updateText(this.toContextPos(fromA), this.toContextPos(toA), insert.toString());
                this.to += dLen;
            }
            off += dLen;
        });
        if (pending && !abort)
            this.revertPending(update.state);
        return !abort;
    }
    update(update) {
        let reverted = this.pendingContextChange;
        if (!this.applyEdits(update) || !this.rangeIsValid(update.state)) {
            this.pendingContextChange = null;
            this.resetRange(update.state);
            this.editContext.updateText(0, this.editContext.text.length, update.state.doc.sliceString(this.from, this.to));
            this.setSelection(update.state);
        }
        else if (update.docChanged || update.selectionSet || reverted) {
            this.setSelection(update.state);
        }
        if (update.geometryChanged || update.docChanged || update.selectionSet)
            update.view.requestMeasure(this.measureReq);
    }
    resetRange(state) {
        let { head } = state.selection.main;
        this.from = Math.max(0, head - 10000 /* CxVp.Margin */);
        this.to = Math.min(state.doc.length, head + 10000 /* CxVp.Margin */);
    }
    revertPending(state) {
        let pending = this.pendingContextChange;
        this.pendingContextChange = null;
        this.editContext.updateText(this.toContextPos(pending.from), this.toContextPos(pending.from + pending.insert.length), state.doc.sliceString(pending.from, pending.to));
    }
    setSelection(state) {
        let { main } = state.selection;
        let start = this.toContextPos(Math.max(this.from, Math.min(this.to, main.anchor)));
        let end = this.toContextPos(main.head);
        if (this.editContext.selectionStart != start || this.editContext.selectionEnd != end)
            this.editContext.updateSelection(start, end);
    }
    rangeIsValid(state) {
        let { head } = state.selection.main;
        return !(this.from > 0 && head - this.from < 500 /* CxVp.MinMargin */ ||
            this.to < state.doc.length && this.to - head < 500 /* CxVp.MinMargin */ ||
            this.to - this.from > 10000 /* CxVp.Margin */ * 3);
    }
    toEditorPos(contextPos) { return contextPos + this.from; }
    toContextPos(editorPos) { return editorPos - this.from; }
    destroy() {
        for (let event in this.handlers)
            this.editContext.removeEventListener(event, this.handlers[event]);
    }
}

// The editor's update state machine looks something like this:
//
//     Idle → Updating ⇆ Idle (unchecked) → Measuring → Idle
//                                         ↑      ↓
//                                         Updating (measure)
//
// The difference between 'Idle' and 'Idle (unchecked)' lies in
// whether a layout check has been scheduled. A regular update through
// the `update` method updates the DOM in a write-only fashion, and
// relies on a check (scheduled with `requestAnimationFrame`) to make
// sure everything is where it should be and the viewport covers the
// visible code. That check continues to measure and then optionally
// update until it reaches a coherent state.
/**
An editor view represents the editor's user interface. It holds
the editable DOM surface, and possibly other elements such as the
line number gutter. It handles events and dispatches state
transactions for editing actions.
*/
class EditorView {
    /**
    The current editor state.
    */
    get state() { return this.viewState.state; }
    /**
    To be able to display large documents without consuming too much
    memory or overloading the browser, CodeMirror only draws the
    code that is visible (plus a margin around it) to the DOM. This
    property tells you the extent of the current drawn viewport, in
    document positions.
    */
    get viewport() { return this.viewState.viewport; }
    /**
    When there are, for example, large collapsed ranges in the
    viewport, its size can be a lot bigger than the actual visible
    content. Thus, if you are doing something like styling the
    content in the viewport, it is preferable to only do so for
    these ranges, which are the subset of the viewport that is
    actually drawn.
    */
    get visibleRanges() { return this.viewState.visibleRanges; }
    /**
    Returns false when the editor is entirely scrolled out of view
    or otherwise hidden.
    */
    get inView() { return this.viewState.inView; }
    /**
    Indicates whether the user is currently composing text via
    [IME](https://en.wikipedia.org/wiki/Input_method), and at least
    one change has been made in the current composition.
    */
    get composing() { return this.inputState.composing > 0; }
    /**
    Indicates whether the user is currently in composing state. Note
    that on some platforms, like Android, this will be the case a
    lot, since just putting the cursor on a word starts a
    composition there.
    */
    get compositionStarted() { return this.inputState.composing >= 0; }
    /**
    The document or shadow root that the view lives in.
    */
    get root() { return this._root; }
    /**
    @internal
    */
    get win() { return this.dom.ownerDocument.defaultView || window; }
    /**
    Construct a new view. You'll want to either provide a `parent`
    option, or put `view.dom` into your document after creating a
    view, so that the user can see the editor.
    */
    constructor(config = {}) {
        this.plugins = [];
        this.pluginMap = new Map;
        this.editorAttrs = {};
        this.contentAttrs = {};
        this.bidiCache = [];
        this.destroyed = false;
        /**
        @internal
        */
        this.updateState = 2 /* UpdateState.Updating */;
        /**
        @internal
        */
        this.measureScheduled = -1;
        /**
        @internal
        */
        this.measureRequests = [];
        this.contentDOM = document.createElement("div");
        this.scrollDOM = document.createElement("div");
        this.scrollDOM.tabIndex = -1;
        this.scrollDOM.className = "cm-scroller";
        this.scrollDOM.appendChild(this.contentDOM);
        this.announceDOM = document.createElement("div");
        this.announceDOM.className = "cm-announced";
        this.announceDOM.setAttribute("aria-live", "polite");
        this.dom = document.createElement("div");
        this.dom.appendChild(this.announceDOM);
        this.dom.appendChild(this.scrollDOM);
        if (config.parent)
            config.parent.appendChild(this.dom);
        let { dispatch } = config;
        this.dispatchTransactions = config.dispatchTransactions ||
            (dispatch && ((trs) => trs.forEach(tr => dispatch(tr, this)))) ||
            ((trs) => this.update(trs));
        this.dispatch = this.dispatch.bind(this);
        this._root = (config.root || getRoot(config.parent) || document);
        this.viewState = new ViewState(config.state || EditorState.create(config));
        if (config.scrollTo && config.scrollTo.is(scrollIntoView))
            this.viewState.scrollTarget = config.scrollTo.value.clip(this.viewState.state);
        this.plugins = this.state.facet(viewPlugin).map(spec => new PluginInstance(spec));
        for (let plugin of this.plugins)
            plugin.update(this);
        this.observer = new DOMObserver(this);
        this.inputState = new InputState(this);
        this.inputState.ensureHandlers(this.plugins);
        this.docView = new DocView(this);
        this.mountStyles();
        this.updateAttrs();
        this.updateState = 0 /* UpdateState.Idle */;
        this.requestMeasure();
    }
    dispatch(...input) {
        let trs = input.length == 1 && input[0] instanceof Transaction ? input
            : input.length == 1 && Array.isArray(input[0]) ? input[0]
                : [this.state.update(...input)];
        this.dispatchTransactions(trs, this);
    }
    /**
    Update the view for the given array of transactions. This will
    update the visible document and selection to match the state
    produced by the transactions, and notify view plugins of the
    change. You should usually call
    [`dispatch`](https://codemirror.net/6/docs/ref/#view.EditorView.dispatch) instead, which uses this
    as a primitive.
    */
    update(transactions) {
        if (this.updateState != 0 /* UpdateState.Idle */)
            throw new Error("Calls to EditorView.update are not allowed while an update is in progress");
        let redrawn = false, attrsChanged = false, update;
        let state = this.state;
        for (let tr of transactions) {
            if (tr.startState != state)
                throw new RangeError("Trying to update state with a transaction that doesn't start from the previous state.");
            state = tr.state;
        }
        if (this.destroyed) {
            this.viewState.state = state;
            return;
        }
        let focus = this.hasFocus, focusFlag = 0, dispatchFocus = null;
        if (transactions.some(tr => tr.annotation(isFocusChange))) {
            this.inputState.notifiedFocused = focus;
            // If a focus-change transaction is being dispatched, set this update flag.
            focusFlag = 1 /* UpdateFlag.Focus */;
        }
        else if (focus != this.inputState.notifiedFocused) {
            this.inputState.notifiedFocused = focus;
            // Schedule a separate focus transaction if necessary, otherwise
            // add a flag to this update
            dispatchFocus = focusChangeTransaction(state, focus);
            if (!dispatchFocus)
                focusFlag = 1 /* UpdateFlag.Focus */;
        }
        // If there was a pending DOM change, eagerly read it and try to
        // apply it after the given transactions.
        let pendingKey = this.observer.delayedAndroidKey, domChange = null;
        if (pendingKey) {
            this.observer.clearDelayedAndroidKey();
            domChange = this.observer.readChange();
            // Only try to apply DOM changes if the transactions didn't
            // change the doc or selection.
            if (domChange && !this.state.doc.eq(state.doc) || !this.state.selection.eq(state.selection))
                domChange = null;
        }
        else {
            this.observer.clear();
        }
        // When the phrases change, redraw the editor
        if (state.facet(EditorState.phrases) != this.state.facet(EditorState.phrases))
            return this.setState(state);
        update = ViewUpdate.create(this, state, transactions);
        update.flags |= focusFlag;
        let scrollTarget = this.viewState.scrollTarget;
        try {
            this.updateState = 2 /* UpdateState.Updating */;
            for (let tr of transactions) {
                if (scrollTarget)
                    scrollTarget = scrollTarget.map(tr.changes);
                if (tr.scrollIntoView) {
                    let { main } = tr.state.selection;
                    scrollTarget = new ScrollTarget(main.empty ? main : EditorSelection.cursor(main.head, main.head > main.anchor ? -1 : 1));
                }
                for (let e of tr.effects)
                    if (e.is(scrollIntoView))
                        scrollTarget = e.value.clip(this.state);
            }
            this.viewState.update(update, scrollTarget);
            this.bidiCache = CachedOrder.update(this.bidiCache, update.changes);
            if (!update.empty) {
                this.updatePlugins(update);
                this.inputState.update(update);
            }
            redrawn = this.docView.update(update);
            if (this.state.facet(styleModule) != this.styleModules)
                this.mountStyles();
            attrsChanged = this.updateAttrs();
            this.showAnnouncements(transactions);
            this.docView.updateSelection(redrawn, transactions.some(tr => tr.isUserEvent("select.pointer")));
        }
        finally {
            this.updateState = 0 /* UpdateState.Idle */;
        }
        if (update.startState.facet(theme) != update.state.facet(theme))
            this.viewState.mustMeasureContent = true;
        if (redrawn || attrsChanged || scrollTarget || this.viewState.mustEnforceCursorAssoc || this.viewState.mustMeasureContent)
            this.requestMeasure();
        if (redrawn)
            this.docViewUpdate();
        if (!update.empty)
            for (let listener of this.state.facet(updateListener)) {
                try {
                    listener(update);
                }
                catch (e) {
                    logException(this.state, e, "update listener");
                }
            }
        if (dispatchFocus || domChange)
            Promise.resolve().then(() => {
                if (dispatchFocus && this.state == dispatchFocus.startState)
                    this.dispatch(dispatchFocus);
                if (domChange) {
                    if (!applyDOMChange(this, domChange) && pendingKey.force)
                        dispatchKey(this.contentDOM, pendingKey.key, pendingKey.keyCode);
                }
            });
    }
    /**
    Reset the view to the given state. (This will cause the entire
    document to be redrawn and all view plugins to be reinitialized,
    so you should probably only use it when the new state isn't
    derived from the old state. Otherwise, use
    [`dispatch`](https://codemirror.net/6/docs/ref/#view.EditorView.dispatch) instead.)
    */
    setState(newState) {
        if (this.updateState != 0 /* UpdateState.Idle */)
            throw new Error("Calls to EditorView.setState are not allowed while an update is in progress");
        if (this.destroyed) {
            this.viewState.state = newState;
            return;
        }
        this.updateState = 2 /* UpdateState.Updating */;
        let hadFocus = this.hasFocus;
        try {
            for (let plugin of this.plugins)
                plugin.destroy(this);
            this.viewState = new ViewState(newState);
            this.plugins = newState.facet(viewPlugin).map(spec => new PluginInstance(spec));
            this.pluginMap.clear();
            for (let plugin of this.plugins)
                plugin.update(this);
            this.docView.destroy();
            this.docView = new DocView(this);
            this.inputState.ensureHandlers(this.plugins);
            this.mountStyles();
            this.updateAttrs();
            this.bidiCache = [];
        }
        finally {
            this.updateState = 0 /* UpdateState.Idle */;
        }
        if (hadFocus)
            this.focus();
        this.requestMeasure();
    }
    updatePlugins(update) {
        let prevSpecs = update.startState.facet(viewPlugin), specs = update.state.facet(viewPlugin);
        if (prevSpecs != specs) {
            let newPlugins = [];
            for (let spec of specs) {
                let found = prevSpecs.indexOf(spec);
                if (found < 0) {
                    newPlugins.push(new PluginInstance(spec));
                }
                else {
                    let plugin = this.plugins[found];
                    plugin.mustUpdate = update;
                    newPlugins.push(plugin);
                }
            }
            for (let plugin of this.plugins)
                if (plugin.mustUpdate != update)
                    plugin.destroy(this);
            this.plugins = newPlugins;
            this.pluginMap.clear();
        }
        else {
            for (let p of this.plugins)
                p.mustUpdate = update;
        }
        for (let i = 0; i < this.plugins.length; i++)
            this.plugins[i].update(this);
        if (prevSpecs != specs)
            this.inputState.ensureHandlers(this.plugins);
    }
    docViewUpdate() {
        for (let plugin of this.plugins) {
            let val = plugin.value;
            if (val && val.docViewUpdate) {
                try {
                    val.docViewUpdate(this);
                }
                catch (e) {
                    logException(this.state, e, "doc view update listener");
                }
            }
        }
    }
    /**
    @internal
    */
    measure(flush = true) {
        if (this.destroyed)
            return;
        if (this.measureScheduled > -1)
            this.win.cancelAnimationFrame(this.measureScheduled);
        if (this.observer.delayedAndroidKey) {
            this.measureScheduled = -1;
            this.requestMeasure();
            return;
        }
        this.measureScheduled = 0; // Prevent requestMeasure calls from scheduling another animation frame
        if (flush)
            this.observer.forceFlush();
        let updated = null;
        let sDOM = this.scrollDOM, scrollTop = sDOM.scrollTop * this.scaleY;
        let { scrollAnchorPos, scrollAnchorHeight } = this.viewState;
        if (Math.abs(scrollTop - this.viewState.scrollTop) > 1)
            scrollAnchorHeight = -1;
        this.viewState.scrollAnchorHeight = -1;
        try {
            for (let i = 0;; i++) {
                if (scrollAnchorHeight < 0) {
                    if (isScrolledToBottom(sDOM)) {
                        scrollAnchorPos = -1;
                        scrollAnchorHeight = this.viewState.heightMap.height;
                    }
                    else {
                        let block = this.viewState.scrollAnchorAt(scrollTop);
                        scrollAnchorPos = block.from;
                        scrollAnchorHeight = block.top;
                    }
                }
                this.updateState = 1 /* UpdateState.Measuring */;
                let changed = this.viewState.measure(this);
                if (!changed && !this.measureRequests.length && this.viewState.scrollTarget == null)
                    break;
                if (i > 5) {
                    console.warn(this.measureRequests.length
                        ? "Measure loop restarted more than 5 times"
                        : "Viewport failed to stabilize");
                    break;
                }
                let measuring = [];
                // Only run measure requests in this cycle when the viewport didn't change
                if (!(changed & 4 /* UpdateFlag.Viewport */))
                    [this.measureRequests, measuring] = [measuring, this.measureRequests];
                let measured = measuring.map(m => {
                    try {
                        return m.read(this);
                    }
                    catch (e) {
                        logException(this.state, e);
                        return BadMeasure;
                    }
                });
                let update = ViewUpdate.create(this, this.state, []), redrawn = false;
                update.flags |= changed;
                if (!updated)
                    updated = update;
                else
                    updated.flags |= changed;
                this.updateState = 2 /* UpdateState.Updating */;
                if (!update.empty) {
                    this.updatePlugins(update);
                    this.inputState.update(update);
                    this.updateAttrs();
                    redrawn = this.docView.update(update);
                    if (redrawn)
                        this.docViewUpdate();
                }
                for (let i = 0; i < measuring.length; i++)
                    if (measured[i] != BadMeasure) {
                        try {
                            let m = measuring[i];
                            if (m.write)
                                m.write(measured[i], this);
                        }
                        catch (e) {
                            logException(this.state, e);
                        }
                    }
                if (redrawn)
                    this.docView.updateSelection(true);
                if (!update.viewportChanged && this.measureRequests.length == 0) {
                    if (this.viewState.editorHeight) {
                        if (this.viewState.scrollTarget) {
                            this.docView.scrollIntoView(this.viewState.scrollTarget);
                            this.viewState.scrollTarget = null;
                            scrollAnchorHeight = -1;
                            continue;
                        }
                        else {
                            let newAnchorHeight = scrollAnchorPos < 0 ? this.viewState.heightMap.height :
                                this.viewState.lineBlockAt(scrollAnchorPos).top;
                            let diff = newAnchorHeight - scrollAnchorHeight;
                            if (diff > 1 || diff < -1) {
                                scrollTop = scrollTop + diff;
                                sDOM.scrollTop = scrollTop / this.scaleY;
                                scrollAnchorHeight = -1;
                                continue;
                            }
                        }
                    }
                    break;
                }
            }
        }
        finally {
            this.updateState = 0 /* UpdateState.Idle */;
            this.measureScheduled = -1;
        }
        if (updated && !updated.empty)
            for (let listener of this.state.facet(updateListener))
                listener(updated);
    }
    /**
    Get the CSS classes for the currently active editor themes.
    */
    get themeClasses() {
        return baseThemeID + " " +
            (this.state.facet(darkTheme) ? baseDarkID : baseLightID) + " " +
            this.state.facet(theme);
    }
    updateAttrs() {
        let editorAttrs = attrsFromFacet(this, editorAttributes, {
            class: "cm-editor" + (this.hasFocus ? " cm-focused " : " ") + this.themeClasses
        });
        let contentAttrs = {
            spellcheck: "false",
            autocorrect: "off",
            autocapitalize: "off",
            translate: "no",
            contenteditable: !this.state.facet(editable) ? "false" : "true",
            class: "cm-content",
            style: `${browser.tabSize}: ${this.state.tabSize}`,
            role: "textbox",
            "aria-multiline": "true"
        };
        if (this.state.readOnly)
            contentAttrs["aria-readonly"] = "true";
        attrsFromFacet(this, contentAttributes, contentAttrs);
        let changed = this.observer.ignore(() => {
            let changedContent = updateAttrs(this.contentDOM, this.contentAttrs, contentAttrs);
            let changedEditor = updateAttrs(this.dom, this.editorAttrs, editorAttrs);
            return changedContent || changedEditor;
        });
        this.editorAttrs = editorAttrs;
        this.contentAttrs = contentAttrs;
        return changed;
    }
    showAnnouncements(trs) {
        let first = true;
        for (let tr of trs)
            for (let effect of tr.effects)
                if (effect.is(EditorView.announce)) {
                    if (first)
                        this.announceDOM.textContent = "";
                    first = false;
                    let div = this.announceDOM.appendChild(document.createElement("div"));
                    div.textContent = effect.value;
                }
    }
    mountStyles() {
        this.styleModules = this.state.facet(styleModule);
        let nonce = this.state.facet(EditorView.cspNonce);
        StyleModule.mount(this.root, this.styleModules.concat(baseTheme$1$1).reverse(), nonce ? { nonce } : undefined);
    }
    readMeasured() {
        if (this.updateState == 2 /* UpdateState.Updating */)
            throw new Error("Reading the editor layout isn't allowed during an update");
        if (this.updateState == 0 /* UpdateState.Idle */ && this.measureScheduled > -1)
            this.measure(false);
    }
    /**
    Schedule a layout measurement, optionally providing callbacks to
    do custom DOM measuring followed by a DOM write phase. Using
    this is preferable reading DOM layout directly from, for
    example, an event handler, because it'll make sure measuring and
    drawing done by other components is synchronized, avoiding
    unnecessary DOM layout computations.
    */
    requestMeasure(request) {
        if (this.measureScheduled < 0)
            this.measureScheduled = this.win.requestAnimationFrame(() => this.measure());
        if (request) {
            if (this.measureRequests.indexOf(request) > -1)
                return;
            if (request.key != null)
                for (let i = 0; i < this.measureRequests.length; i++) {
                    if (this.measureRequests[i].key === request.key) {
                        this.measureRequests[i] = request;
                        return;
                    }
                }
            this.measureRequests.push(request);
        }
    }
    /**
    Get the value of a specific plugin, if present. Note that
    plugins that crash can be dropped from a view, so even when you
    know you registered a given plugin, it is recommended to check
    the return value of this method.
    */
    plugin(plugin) {
        let known = this.pluginMap.get(plugin);
        if (known === undefined || known && known.spec != plugin)
            this.pluginMap.set(plugin, known = this.plugins.find(p => p.spec == plugin) || null);
        return known && known.update(this).value;
    }
    /**
    The top position of the document, in screen coordinates. This
    may be negative when the editor is scrolled down. Points
    directly to the top of the first line, not above the padding.
    */
    get documentTop() {
        return this.contentDOM.getBoundingClientRect().top + this.viewState.paddingTop;
    }
    /**
    Reports the padding above and below the document.
    */
    get documentPadding() {
        return { top: this.viewState.paddingTop, bottom: this.viewState.paddingBottom };
    }
    /**
    If the editor is transformed with CSS, this provides the scale
    along the X axis. Otherwise, it will just be 1. Note that
    transforms other than translation and scaling are not supported.
    */
    get scaleX() { return this.viewState.scaleX; }
    /**
    Provide the CSS transformed scale along the Y axis.
    */
    get scaleY() { return this.viewState.scaleY; }
    /**
    Find the text line or block widget at the given vertical
    position (which is interpreted as relative to the [top of the
    document](https://codemirror.net/6/docs/ref/#view.EditorView.documentTop)).
    */
    elementAtHeight(height) {
        this.readMeasured();
        return this.viewState.elementAtHeight(height);
    }
    /**
    Find the line block (see
    [`lineBlockAt`](https://codemirror.net/6/docs/ref/#view.EditorView.lineBlockAt) at the given
    height, again interpreted relative to the [top of the
    document](https://codemirror.net/6/docs/ref/#view.EditorView.documentTop).
    */
    lineBlockAtHeight(height) {
        this.readMeasured();
        return this.viewState.lineBlockAtHeight(height);
    }
    /**
    Get the extent and vertical position of all [line
    blocks](https://codemirror.net/6/docs/ref/#view.EditorView.lineBlockAt) in the viewport. Positions
    are relative to the [top of the
    document](https://codemirror.net/6/docs/ref/#view.EditorView.documentTop);
    */
    get viewportLineBlocks() {
        return this.viewState.viewportLines;
    }
    /**
    Find the line block around the given document position. A line
    block is a range delimited on both sides by either a
    non-[hidden](https://codemirror.net/6/docs/ref/#view.Decoration^replace) line breaks, or the
    start/end of the document. It will usually just hold a line of
    text, but may be broken into multiple textblocks by block
    widgets.
    */
    lineBlockAt(pos) {
        return this.viewState.lineBlockAt(pos);
    }
    /**
    The editor's total content height.
    */
    get contentHeight() {
        return this.viewState.contentHeight;
    }
    /**
    Move a cursor position by [grapheme
    cluster](https://codemirror.net/6/docs/ref/#state.findClusterBreak). `forward` determines whether
    the motion is away from the line start, or towards it. In
    bidirectional text, the line is traversed in visual order, using
    the editor's [text direction](https://codemirror.net/6/docs/ref/#view.EditorView.textDirection).
    When the start position was the last one on the line, the
    returned position will be across the line break. If there is no
    further line, the original position is returned.
    
    By default, this method moves over a single cluster. The
    optional `by` argument can be used to move across more. It will
    be called with the first cluster as argument, and should return
    a predicate that determines, for each subsequent cluster,
    whether it should also be moved over.
    */
    moveByChar(start, forward, by) {
        return skipAtoms(this, start, moveByChar(this, start, forward, by));
    }
    /**
    Move a cursor position across the next group of either
    [letters](https://codemirror.net/6/docs/ref/#state.EditorState.charCategorizer) or non-letter
    non-whitespace characters.
    */
    moveByGroup(start, forward) {
        return skipAtoms(this, start, moveByChar(this, start, forward, initial => byGroup(this, start.head, initial)));
    }
    /**
    Get the cursor position visually at the start or end of a line.
    Note that this may differ from the _logical_ position at its
    start or end (which is simply at `line.from`/`line.to`) if text
    at the start or end goes against the line's base text direction.
    */
    visualLineSide(line, end) {
        let order = this.bidiSpans(line), dir = this.textDirectionAt(line.from);
        let span = order[end ? order.length - 1 : 0];
        return EditorSelection.cursor(span.side(end, dir) + line.from, span.forward(!end, dir) ? 1 : -1);
    }
    /**
    Move to the next line boundary in the given direction. If
    `includeWrap` is true, line wrapping is on, and there is a
    further wrap point on the current line, the wrap point will be
    returned. Otherwise this function will return the start or end
    of the line.
    */
    moveToLineBoundary(start, forward, includeWrap = true) {
        return moveToLineBoundary(this, start, forward, includeWrap);
    }
    /**
    Move a cursor position vertically. When `distance` isn't given,
    it defaults to moving to the next line (including wrapped
    lines). Otherwise, `distance` should provide a positive distance
    in pixels.
    
    When `start` has a
    [`goalColumn`](https://codemirror.net/6/docs/ref/#state.SelectionRange.goalColumn), the vertical
    motion will use that as a target horizontal position. Otherwise,
    the cursor's own horizontal position is used. The returned
    cursor will have its goal column set to whichever column was
    used.
    */
    moveVertically(start, forward, distance) {
        return skipAtoms(this, start, moveVertically(this, start, forward, distance));
    }
    /**
    Find the DOM parent node and offset (child offset if `node` is
    an element, character offset when it is a text node) at the
    given document position.
    
    Note that for positions that aren't currently in
    `visibleRanges`, the resulting DOM position isn't necessarily
    meaningful (it may just point before or after a placeholder
    element).
    */
    domAtPos(pos) {
        return this.docView.domAtPos(pos);
    }
    /**
    Find the document position at the given DOM node. Can be useful
    for associating positions with DOM events. Will raise an error
    when `node` isn't part of the editor content.
    */
    posAtDOM(node, offset = 0) {
        return this.docView.posFromDOM(node, offset);
    }
    posAtCoords(coords, precise = true) {
        this.readMeasured();
        return posAtCoords(this, coords, precise);
    }
    /**
    Get the screen coordinates at the given document position.
    `side` determines whether the coordinates are based on the
    element before (-1) or after (1) the position (if no element is
    available on the given side, the method will transparently use
    another strategy to get reasonable coordinates).
    */
    coordsAtPos(pos, side = 1) {
        this.readMeasured();
        let rect = this.docView.coordsAt(pos, side);
        if (!rect || rect.left == rect.right)
            return rect;
        let line = this.state.doc.lineAt(pos), order = this.bidiSpans(line);
        let span = order[BidiSpan.find(order, pos - line.from, -1, side)];
        return flattenRect(rect, (span.dir == Direction.LTR) == (side > 0));
    }
    /**
    Return the rectangle around a given character. If `pos` does not
    point in front of a character that is in the viewport and
    rendered (i.e. not replaced, not a line break), this will return
    null. For space characters that are a line wrap point, this will
    return the position before the line break.
    */
    coordsForChar(pos) {
        this.readMeasured();
        return this.docView.coordsForChar(pos);
    }
    /**
    The default width of a character in the editor. May not
    accurately reflect the width of all characters (given variable
    width fonts or styling of invididual ranges).
    */
    get defaultCharacterWidth() { return this.viewState.heightOracle.charWidth; }
    /**
    The default height of a line in the editor. May not be accurate
    for all lines.
    */
    get defaultLineHeight() { return this.viewState.heightOracle.lineHeight; }
    /**
    The text direction
    ([`direction`](https://developer.mozilla.org/en-US/docs/Web/CSS/direction)
    CSS property) of the editor's content element.
    */
    get textDirection() { return this.viewState.defaultTextDirection; }
    /**
    Find the text direction of the block at the given position, as
    assigned by CSS. If
    [`perLineTextDirection`](https://codemirror.net/6/docs/ref/#view.EditorView^perLineTextDirection)
    isn't enabled, or the given position is outside of the viewport,
    this will always return the same as
    [`textDirection`](https://codemirror.net/6/docs/ref/#view.EditorView.textDirection). Note that
    this may trigger a DOM layout.
    */
    textDirectionAt(pos) {
        let perLine = this.state.facet(perLineTextDirection);
        if (!perLine || pos < this.viewport.from || pos > this.viewport.to)
            return this.textDirection;
        this.readMeasured();
        return this.docView.textDirectionAt(pos);
    }
    /**
    Whether this editor [wraps lines](https://codemirror.net/6/docs/ref/#view.EditorView.lineWrapping)
    (as determined by the
    [`white-space`](https://developer.mozilla.org/en-US/docs/Web/CSS/white-space)
    CSS property of its content element).
    */
    get lineWrapping() { return this.viewState.heightOracle.lineWrapping; }
    /**
    Returns the bidirectional text structure of the given line
    (which should be in the current document) as an array of span
    objects. The order of these spans matches the [text
    direction](https://codemirror.net/6/docs/ref/#view.EditorView.textDirection)—if that is
    left-to-right, the leftmost spans come first, otherwise the
    rightmost spans come first.
    */
    bidiSpans(line) {
        if (line.length > MaxBidiLine)
            return trivialOrder(line.length);
        let dir = this.textDirectionAt(line.from), isolates;
        for (let entry of this.bidiCache) {
            if (entry.from == line.from && entry.dir == dir &&
                (entry.fresh || isolatesEq(entry.isolates, isolates = getIsolatedRanges(this, line))))
                return entry.order;
        }
        if (!isolates)
            isolates = getIsolatedRanges(this, line);
        let order = computeOrder(line.text, dir, isolates);
        this.bidiCache.push(new CachedOrder(line.from, line.to, dir, isolates, true, order));
        return order;
    }
    /**
    Check whether the editor has focus.
    */
    get hasFocus() {
        var _a;
        // Safari return false for hasFocus when the context menu is open
        // or closing, which leads us to ignore selection changes from the
        // context menu because it looks like the editor isn't focused.
        // This kludges around that.
        return (this.dom.ownerDocument.hasFocus() || browser.safari && ((_a = this.inputState) === null || _a === void 0 ? void 0 : _a.lastContextMenu) > Date.now() - 3e4) &&
            this.root.activeElement == this.contentDOM;
    }
    /**
    Put focus on the editor.
    */
    focus() {
        this.observer.ignore(() => {
            focusPreventScroll(this.contentDOM);
            this.docView.updateSelection();
        });
    }
    /**
    Update the [root](https://codemirror.net/6/docs/ref/##view.EditorViewConfig.root) in which the editor lives. This is only
    necessary when moving the editor's existing DOM to a new window or shadow root.
    */
    setRoot(root) {
        if (this._root != root) {
            this._root = root;
            this.observer.setWindow((root.nodeType == 9 ? root : root.ownerDocument).defaultView || window);
            this.mountStyles();
        }
    }
    /**
    Clean up this editor view, removing its element from the
    document, unregistering event handlers, and notifying
    plugins. The view instance can no longer be used after
    calling this.
    */
    destroy() {
        if (this.root.activeElement == this.contentDOM)
            this.contentDOM.blur();
        for (let plugin of this.plugins)
            plugin.destroy(this);
        this.plugins = [];
        this.inputState.destroy();
        this.docView.destroy();
        this.dom.remove();
        this.observer.destroy();
        if (this.measureScheduled > -1)
            this.win.cancelAnimationFrame(this.measureScheduled);
        this.destroyed = true;
    }
    /**
    Returns an effect that can be
    [added](https://codemirror.net/6/docs/ref/#state.TransactionSpec.effects) to a transaction to
    cause it to scroll the given position or range into view.
    */
    static scrollIntoView(pos, options = {}) {
        return scrollIntoView.of(new ScrollTarget(typeof pos == "number" ? EditorSelection.cursor(pos) : pos, options.y, options.x, options.yMargin, options.xMargin));
    }
    /**
    Return an effect that resets the editor to its current (at the
    time this method was called) scroll position. Note that this
    only affects the editor's own scrollable element, not parents.
    See also
    [`EditorViewConfig.scrollTo`](https://codemirror.net/6/docs/ref/#view.EditorViewConfig.scrollTo).
    
    The effect should be used with a document identical to the one
    it was created for. Failing to do so is not an error, but may
    not scroll to the expected position. You can
    [map](https://codemirror.net/6/docs/ref/#state.StateEffect.map) the effect to account for changes.
    */
    scrollSnapshot() {
        let { scrollTop, scrollLeft } = this.scrollDOM;
        let ref = this.viewState.scrollAnchorAt(scrollTop);
        return scrollIntoView.of(new ScrollTarget(EditorSelection.cursor(ref.from), "start", "start", ref.top - scrollTop, scrollLeft, true));
    }
    /**
    Enable or disable tab-focus mode, which disables key bindings
    for Tab and Shift-Tab, letting the browser's default
    focus-changing behavior go through instead. This is useful to
    prevent trapping keyboard users in your editor.
    
    Without argument, this toggles the mode. With a boolean, it
    enables (true) or disables it (false). Given a number, it
    temporarily enables the mode until that number of milliseconds
    have passed or another non-Tab key is pressed.
    */
    setTabFocusMode(to) {
        if (to == null)
            this.inputState.tabFocusMode = this.inputState.tabFocusMode < 0 ? 0 : -1;
        else if (typeof to == "boolean")
            this.inputState.tabFocusMode = to ? 0 : -1;
        else if (this.inputState.tabFocusMode != 0)
            this.inputState.tabFocusMode = Date.now() + to;
    }
    /**
    Returns an extension that can be used to add DOM event handlers.
    The value should be an object mapping event names to handler
    functions. For any given event, such functions are ordered by
    extension precedence, and the first handler to return true will
    be assumed to have handled that event, and no other handlers or
    built-in behavior will be activated for it. These are registered
    on the [content element](https://codemirror.net/6/docs/ref/#view.EditorView.contentDOM), except
    for `scroll` handlers, which will be called any time the
    editor's [scroll element](https://codemirror.net/6/docs/ref/#view.EditorView.scrollDOM) or one of
    its parent nodes is scrolled.
    */
    static domEventHandlers(handlers) {
        return ViewPlugin.define(() => ({}), { eventHandlers: handlers });
    }
    /**
    Create an extension that registers DOM event observers. Contrary
    to event [handlers](https://codemirror.net/6/docs/ref/#view.EditorView^domEventHandlers),
    observers can't be prevented from running by a higher-precedence
    handler returning true. They also don't prevent other handlers
    and observers from running when they return true, and should not
    call `preventDefault`.
    */
    static domEventObservers(observers) {
        return ViewPlugin.define(() => ({}), { eventObservers: observers });
    }
    /**
    Create a theme extension. The first argument can be a
    [`style-mod`](https://github.com/marijnh/style-mod#documentation)
    style spec providing the styles for the theme. These will be
    prefixed with a generated class for the style.
    
    Because the selectors will be prefixed with a scope class, rule
    that directly match the editor's [wrapper
    element](https://codemirror.net/6/docs/ref/#view.EditorView.dom)—to which the scope class will be
    added—need to be explicitly differentiated by adding an `&` to
    the selector for that element—for example
    `&.cm-focused`.
    
    When `dark` is set to true, the theme will be marked as dark,
    which will cause the `&dark` rules from [base
    themes](https://codemirror.net/6/docs/ref/#view.EditorView^baseTheme) to be used (as opposed to
    `&light` when a light theme is active).
    */
    static theme(spec, options) {
        let prefix = StyleModule.newName();
        let result = [theme.of(prefix), styleModule.of(buildTheme(`.${prefix}`, spec))];
        if (options && options.dark)
            result.push(darkTheme.of(true));
        return result;
    }
    /**
    Create an extension that adds styles to the base theme. Like
    with [`theme`](https://codemirror.net/6/docs/ref/#view.EditorView^theme), use `&` to indicate the
    place of the editor wrapper element when directly targeting
    that. You can also use `&dark` or `&light` instead to only
    target editors with a dark or light theme.
    */
    static baseTheme(spec) {
        return Prec.lowest(styleModule.of(buildTheme("." + baseThemeID, spec, lightDarkIDs)));
    }
    /**
    Retrieve an editor view instance from the view's DOM
    representation.
    */
    static findFromDOM(dom) {
        var _a;
        let content = dom.querySelector(".cm-content");
        let cView = content && ContentView.get(content) || ContentView.get(dom);
        return ((_a = cView === null || cView === void 0 ? void 0 : cView.rootView) === null || _a === void 0 ? void 0 : _a.view) || null;
    }
}
/**
Facet to add a [style
module](https://github.com/marijnh/style-mod#documentation) to
an editor view. The view will ensure that the module is
mounted in its [document
root](https://codemirror.net/6/docs/ref/#view.EditorView.constructor^config.root).
*/
EditorView.styleModule = styleModule;
/**
An input handler can override the way changes to the editable
DOM content are handled. Handlers are passed the document
positions between which the change was found, and the new
content. When one returns true, no further input handlers are
called and the default behavior is prevented.

The `insert` argument can be used to get the default transaction
that would be applied for this input. This can be useful when
dispatching the custom behavior as a separate transaction.
*/
EditorView.inputHandler = inputHandler;
/**
Scroll handlers can override how things are scrolled into view.
If they return `true`, no further handling happens for the
scrolling. If they return false, the default scroll behavior is
applied. Scroll handlers should never initiate editor updates.
*/
EditorView.scrollHandler = scrollHandler;
/**
This facet can be used to provide functions that create effects
to be dispatched when the editor's focus state changes.
*/
EditorView.focusChangeEffect = focusChangeEffect;
/**
By default, the editor assumes all its content has the same
[text direction](https://codemirror.net/6/docs/ref/#view.Direction). Configure this with a `true`
value to make it read the text direction of every (rendered)
line separately.
*/
EditorView.perLineTextDirection = perLineTextDirection;
/**
Allows you to provide a function that should be called when the
library catches an exception from an extension (mostly from view
plugins, but may be used by other extensions to route exceptions
from user-code-provided callbacks). This is mostly useful for
debugging and logging. See [`logException`](https://codemirror.net/6/docs/ref/#view.logException).
*/
EditorView.exceptionSink = exceptionSink;
/**
A facet that can be used to register a function to be called
every time the view updates.
*/
EditorView.updateListener = updateListener;
/**
Facet that controls whether the editor content DOM is editable.
When its highest-precedence value is `false`, the element will
not have its `contenteditable` attribute set. (Note that this
doesn't affect API calls that change the editor content, even
when those are bound to keys or buttons. See the
[`readOnly`](https://codemirror.net/6/docs/ref/#state.EditorState.readOnly) facet for that.)
*/
EditorView.editable = editable;
/**
Allows you to influence the way mouse selection happens. The
functions in this facet will be called for a `mousedown` event
on the editor, and can return an object that overrides the way a
selection is computed from that mouse click or drag.
*/
EditorView.mouseSelectionStyle = mouseSelectionStyle;
/**
Facet used to configure whether a given selection drag event
should move or copy the selection. The given predicate will be
called with the `mousedown` event, and can return `true` when
the drag should move the content.
*/
EditorView.dragMovesSelection = dragMovesSelection$1;
/**
Facet used to configure whether a given selecting click adds a
new range to the existing selection or replaces it entirely. The
default behavior is to check `event.metaKey` on macOS, and
`event.ctrlKey` elsewhere.
*/
EditorView.clickAddsSelectionRange = clickAddsSelectionRange;
/**
A facet that determines which [decorations](https://codemirror.net/6/docs/ref/#view.Decoration)
are shown in the view. Decorations can be provided in two
ways—directly, or via a function that takes an editor view.

Only decoration sets provided directly are allowed to influence
the editor's vertical layout structure. The ones provided as
functions are called _after_ the new viewport has been computed,
and thus **must not** introduce block widgets or replacing
decorations that cover line breaks.

If you want decorated ranges to behave like atomic units for
cursor motion and deletion purposes, also provide the range set
containing the decorations to
[`EditorView.atomicRanges`](https://codemirror.net/6/docs/ref/#view.EditorView^atomicRanges).
*/
EditorView.decorations = decorations;
/**
Facet that works much like
[`decorations`](https://codemirror.net/6/docs/ref/#view.EditorView^decorations), but puts its
inputs at the very bottom of the precedence stack, meaning mark
decorations provided here will only be split by other, partially
overlapping \`outerDecorations\` ranges, and wrap around all
regular decorations. Use this for mark elements that should, as
much as possible, remain in one piece.
*/
EditorView.outerDecorations = outerDecorations;
/**
Used to provide ranges that should be treated as atoms as far as
cursor motion is concerned. This causes methods like
[`moveByChar`](https://codemirror.net/6/docs/ref/#view.EditorView.moveByChar) and
[`moveVertically`](https://codemirror.net/6/docs/ref/#view.EditorView.moveVertically) (and the
commands built on top of them) to skip across such regions when
a selection endpoint would enter them. This does _not_ prevent
direct programmatic [selection
updates](https://codemirror.net/6/docs/ref/#state.TransactionSpec.selection) from moving into such
regions.
*/
EditorView.atomicRanges = atomicRanges;
/**
When range decorations add a `unicode-bidi: isolate` style, they
should also include a
[`bidiIsolate`](https://codemirror.net/6/docs/ref/#view.MarkDecorationSpec.bidiIsolate) property
in their decoration spec, and be exposed through this facet, so
that the editor can compute the proper text order. (Other values
for `unicode-bidi`, except of course `normal`, are not
supported.)
*/
EditorView.bidiIsolatedRanges = bidiIsolatedRanges;
/**
Facet that allows extensions to provide additional scroll
margins (space around the sides of the scrolling element that
should be considered invisible). This can be useful when the
plugin introduces elements that cover part of that element (for
example a horizontally fixed gutter).
*/
EditorView.scrollMargins = scrollMargins;
/**
This facet records whether a dark theme is active. The extension
returned by [`theme`](https://codemirror.net/6/docs/ref/#view.EditorView^theme) automatically
includes an instance of this when the `dark` option is set to
true.
*/
EditorView.darkTheme = darkTheme;
/**
Provides a Content Security Policy nonce to use when creating
the style sheets for the editor. Holds the empty string when no
nonce has been provided.
*/
EditorView.cspNonce = /*@__PURE__*/Facet.define({ combine: values => values.length ? values[0] : "" });
/**
Facet that provides additional DOM attributes for the editor's
editable DOM element.
*/
EditorView.contentAttributes = contentAttributes;
/**
Facet that provides DOM attributes for the editor's outer
element.
*/
EditorView.editorAttributes = editorAttributes;
/**
An extension that enables line wrapping in the editor (by
setting CSS `white-space` to `pre-wrap` in the content).
*/
EditorView.lineWrapping = /*@__PURE__*/EditorView.contentAttributes.of({ "class": "cm-lineWrapping" });
/**
State effect used to include screen reader announcements in a
transaction. These will be added to the DOM in a visually hidden
element with `aria-live="polite"` set, and should be used to
describe effects that are visually obvious but may not be
noticed by screen reader users (such as moving to the next
search match).
*/
EditorView.announce = /*@__PURE__*/StateEffect.define();
// Maximum line length for which we compute accurate bidi info
const MaxBidiLine = 4096;
const BadMeasure = {};
class CachedOrder {
    constructor(from, to, dir, isolates, fresh, order) {
        this.from = from;
        this.to = to;
        this.dir = dir;
        this.isolates = isolates;
        this.fresh = fresh;
        this.order = order;
    }
    static update(cache, changes) {
        if (changes.empty && !cache.some(c => c.fresh))
            return cache;
        let result = [], lastDir = cache.length ? cache[cache.length - 1].dir : Direction.LTR;
        for (let i = Math.max(0, cache.length - 10); i < cache.length; i++) {
            let entry = cache[i];
            if (entry.dir == lastDir && !changes.touchesRange(entry.from, entry.to))
                result.push(new CachedOrder(changes.mapPos(entry.from, 1), changes.mapPos(entry.to, -1), entry.dir, entry.isolates, false, entry.order));
        }
        return result;
    }
}
function attrsFromFacet(view, facet, base) {
    for (let sources = view.state.facet(facet), i = sources.length - 1; i >= 0; i--) {
        let source = sources[i], value = typeof source == "function" ? source(view) : source;
        if (value)
            combineAttrs(value, base);
    }
    return base;
}

const currentPlatform = browser.mac ? "mac" : browser.windows ? "win" : browser.linux ? "linux" : "key";
function normalizeKeyName(name, platform) {
    const parts = name.split(/-(?!$)/);
    let result = parts[parts.length - 1];
    if (result == "Space")
        result = " ";
    let alt, ctrl, shift, meta;
    for (let i = 0; i < parts.length - 1; ++i) {
        const mod = parts[i];
        if (/^(cmd|meta|m)$/i.test(mod))
            meta = true;
        else if (/^a(lt)?$/i.test(mod))
            alt = true;
        else if (/^(c|ctrl|control)$/i.test(mod))
            ctrl = true;
        else if (/^s(hift)?$/i.test(mod))
            shift = true;
        else if (/^mod$/i.test(mod)) {
            if (platform == "mac")
                meta = true;
            else
                ctrl = true;
        }
        else
            throw new Error("Unrecognized modifier name: " + mod);
    }
    if (alt)
        result = "Alt-" + result;
    if (ctrl)
        result = "Ctrl-" + result;
    if (meta)
        result = "Meta-" + result;
    if (shift)
        result = "Shift-" + result;
    return result;
}
function modifiers(name, event, shift) {
    if (event.altKey)
        name = "Alt-" + name;
    if (event.ctrlKey)
        name = "Ctrl-" + name;
    if (event.metaKey)
        name = "Meta-" + name;
    if (shift !== false && event.shiftKey)
        name = "Shift-" + name;
    return name;
}
const handleKeyEvents = /*@__PURE__*/Prec.default(/*@__PURE__*/EditorView.domEventHandlers({
    keydown(event, view) {
        return runHandlers(getKeymap(view.state), event, view, "editor");
    }
}));
/**
Facet used for registering keymaps.

You can add multiple keymaps to an editor. Their priorities
determine their precedence (the ones specified early or with high
priority get checked first). When a handler has returned `true`
for a given key, no further handlers are called.
*/
const keymap = /*@__PURE__*/Facet.define({ enables: handleKeyEvents });
const Keymaps = /*@__PURE__*/new WeakMap();
// This is hidden behind an indirection, rather than directly computed
// by the facet, to keep internal types out of the facet's type.
function getKeymap(state) {
    let bindings = state.facet(keymap);
    let map = Keymaps.get(bindings);
    if (!map)
        Keymaps.set(bindings, map = buildKeymap(bindings.reduce((a, b) => a.concat(b), [])));
    return map;
}
let storedPrefix = null;
const PrefixTimeout = 4000;
function buildKeymap(bindings, platform = currentPlatform) {
    let bound = Object.create(null);
    let isPrefix = Object.create(null);
    let checkPrefix = (name, is) => {
        let current = isPrefix[name];
        if (current == null)
            isPrefix[name] = is;
        else if (current != is)
            throw new Error("Key binding " + name + " is used both as a regular binding and as a multi-stroke prefix");
    };
    let add = (scope, key, command, preventDefault, stopPropagation) => {
        var _a, _b;
        let scopeObj = bound[scope] || (bound[scope] = Object.create(null));
        let parts = key.split(/ (?!$)/).map(k => normalizeKeyName(k, platform));
        for (let i = 1; i < parts.length; i++) {
            let prefix = parts.slice(0, i).join(" ");
            checkPrefix(prefix, true);
            if (!scopeObj[prefix])
                scopeObj[prefix] = {
                    preventDefault: true,
                    stopPropagation: false,
                    run: [(view) => {
                            let ourObj = storedPrefix = { view, prefix, scope };
                            setTimeout(() => { if (storedPrefix == ourObj)
                                storedPrefix = null; }, PrefixTimeout);
                            return true;
                        }]
                };
        }
        let full = parts.join(" ");
        checkPrefix(full, false);
        let binding = scopeObj[full] || (scopeObj[full] = {
            preventDefault: false,
            stopPropagation: false,
            run: ((_b = (_a = scopeObj._any) === null || _a === void 0 ? void 0 : _a.run) === null || _b === void 0 ? void 0 : _b.slice()) || []
        });
        if (command)
            binding.run.push(command);
        if (preventDefault)
            binding.preventDefault = true;
        if (stopPropagation)
            binding.stopPropagation = true;
    };
    for (let b of bindings) {
        let scopes = b.scope ? b.scope.split(" ") : ["editor"];
        if (b.any)
            for (let scope of scopes) {
                let scopeObj = bound[scope] || (bound[scope] = Object.create(null));
                if (!scopeObj._any)
                    scopeObj._any = { preventDefault: false, stopPropagation: false, run: [] };
                let { any } = b;
                for (let key in scopeObj)
                    scopeObj[key].run.push(view => any(view, currentKeyEvent));
            }
        let name = b[platform] || b.key;
        if (!name)
            continue;
        for (let scope of scopes) {
            add(scope, name, b.run, b.preventDefault, b.stopPropagation);
            if (b.shift)
                add(scope, "Shift-" + name, b.shift, b.preventDefault, b.stopPropagation);
        }
    }
    return bound;
}
let currentKeyEvent = null;
function runHandlers(map, event, view, scope) {
    currentKeyEvent = event;
    let name = keyName(event);
    let charCode = codePointAt(name, 0), isChar = codePointSize(charCode) == name.length && name != " ";
    let prefix = "", handled = false, prevented = false, stopPropagation = false;
    if (storedPrefix && storedPrefix.view == view && storedPrefix.scope == scope) {
        prefix = storedPrefix.prefix + " ";
        if (modifierCodes.indexOf(event.keyCode) < 0) {
            prevented = true;
            storedPrefix = null;
        }
    }
    let ran = new Set;
    let runFor = (binding) => {
        if (binding) {
            for (let cmd of binding.run)
                if (!ran.has(cmd)) {
                    ran.add(cmd);
                    if (cmd(view)) {
                        if (binding.stopPropagation)
                            stopPropagation = true;
                        return true;
                    }
                }
            if (binding.preventDefault) {
                if (binding.stopPropagation)
                    stopPropagation = true;
                prevented = true;
            }
        }
        return false;
    };
    let scopeObj = map[scope], baseName, shiftName;
    if (scopeObj) {
        if (runFor(scopeObj[prefix + modifiers(name, event, !isChar)])) {
            handled = true;
        }
        else if (isChar && (event.altKey || event.metaKey || event.ctrlKey) &&
            // Ctrl-Alt may be used for AltGr on Windows
            !(browser.windows && event.ctrlKey && event.altKey) &&
            (baseName = base[event.keyCode]) && baseName != name) {
            if (runFor(scopeObj[prefix + modifiers(baseName, event, true)])) {
                handled = true;
            }
            else if (event.shiftKey && (shiftName = shift[event.keyCode]) != name && shiftName != baseName &&
                runFor(scopeObj[prefix + modifiers(shiftName, event, false)])) {
                handled = true;
            }
        }
        else if (isChar && event.shiftKey &&
            runFor(scopeObj[prefix + modifiers(name, event, true)])) {
            handled = true;
        }
        if (!handled && runFor(scopeObj._any))
            handled = true;
    }
    if (prevented)
        handled = true;
    if (handled && stopPropagation)
        event.stopPropagation();
    currentKeyEvent = null;
    return handled;
}

/**
Implementation of [`LayerMarker`](https://codemirror.net/6/docs/ref/#view.LayerMarker) that creates
a rectangle at a given set of coordinates.
*/
class RectangleMarker {
    /**
    Create a marker with the given class and dimensions. If `width`
    is null, the DOM element will get no width style.
    */
    constructor(className, 
    /**
    The left position of the marker (in pixels, document-relative).
    */
    left, 
    /**
    The top position of the marker.
    */
    top, 
    /**
    The width of the marker, or null if it shouldn't get a width assigned.
    */
    width, 
    /**
    The height of the marker.
    */
    height) {
        this.className = className;
        this.left = left;
        this.top = top;
        this.width = width;
        this.height = height;
    }
    draw() {
        let elt = document.createElement("div");
        elt.className = this.className;
        this.adjust(elt);
        return elt;
    }
    update(elt, prev) {
        if (prev.className != this.className)
            return false;
        this.adjust(elt);
        return true;
    }
    adjust(elt) {
        elt.style.left = this.left + "px";
        elt.style.top = this.top + "px";
        if (this.width != null)
            elt.style.width = this.width + "px";
        elt.style.height = this.height + "px";
    }
    eq(p) {
        return this.left == p.left && this.top == p.top && this.width == p.width && this.height == p.height &&
            this.className == p.className;
    }
    /**
    Create a set of rectangles for the given selection range,
    assigning them theclass`className`. Will create a single
    rectangle for empty ranges, and a set of selection-style
    rectangles covering the range's content (in a bidi-aware
    way) for non-empty ones.
    */
    static forRange(view, className, range) {
        if (range.empty) {
            let pos = view.coordsAtPos(range.head, range.assoc || 1);
            if (!pos)
                return [];
            let base = getBase(view);
            return [new RectangleMarker(className, pos.left - base.left, pos.top - base.top, null, pos.bottom - pos.top)];
        }
        else {
            return rectanglesForRange(view, className, range);
        }
    }
}
function getBase(view) {
    let rect = view.scrollDOM.getBoundingClientRect();
    let left = view.textDirection == Direction.LTR ? rect.left : rect.right - view.scrollDOM.clientWidth * view.scaleX;
    return { left: left - view.scrollDOM.scrollLeft * view.scaleX, top: rect.top - view.scrollDOM.scrollTop * view.scaleY };
}
function wrappedLine(view, pos, side, inside) {
    let coords = view.coordsAtPos(pos, side * 2);
    if (!coords)
        return inside;
    let editorRect = view.dom.getBoundingClientRect();
    let y = (coords.top + coords.bottom) / 2;
    let left = view.posAtCoords({ x: editorRect.left + 1, y });
    let right = view.posAtCoords({ x: editorRect.right - 1, y });
    if (left == null || right == null)
        return inside;
    return { from: Math.max(inside.from, Math.min(left, right)), to: Math.min(inside.to, Math.max(left, right)) };
}
function rectanglesForRange(view, className, range) {
    if (range.to <= view.viewport.from || range.from >= view.viewport.to)
        return [];
    let from = Math.max(range.from, view.viewport.from), to = Math.min(range.to, view.viewport.to);
    let ltr = view.textDirection == Direction.LTR;
    let content = view.contentDOM, contentRect = content.getBoundingClientRect(), base = getBase(view);
    let lineElt = content.querySelector(".cm-line"), lineStyle = lineElt && window.getComputedStyle(lineElt);
    let leftSide = contentRect.left +
        (lineStyle ? parseInt(lineStyle.paddingLeft) + Math.min(0, parseInt(lineStyle.textIndent)) : 0);
    let rightSide = contentRect.right - (lineStyle ? parseInt(lineStyle.paddingRight) : 0);
    let startBlock = blockAt(view, from), endBlock = blockAt(view, to);
    let visualStart = startBlock.type == BlockType.Text ? startBlock : null;
    let visualEnd = endBlock.type == BlockType.Text ? endBlock : null;
    if (visualStart && (view.lineWrapping || startBlock.widgetLineBreaks))
        visualStart = wrappedLine(view, from, 1, visualStart);
    if (visualEnd && (view.lineWrapping || endBlock.widgetLineBreaks))
        visualEnd = wrappedLine(view, to, -1, visualEnd);
    if (visualStart && visualEnd && visualStart.from == visualEnd.from && visualStart.to == visualEnd.to) {
        return pieces(drawForLine(range.from, range.to, visualStart));
    }
    else {
        let top = visualStart ? drawForLine(range.from, null, visualStart) : drawForWidget(startBlock, false);
        let bottom = visualEnd ? drawForLine(null, range.to, visualEnd) : drawForWidget(endBlock, true);
        let between = [];
        if ((visualStart || startBlock).to < (visualEnd || endBlock).from - (visualStart && visualEnd ? 1 : 0) ||
            startBlock.widgetLineBreaks > 1 && top.bottom + view.defaultLineHeight / 2 < bottom.top)
            between.push(piece(leftSide, top.bottom, rightSide, bottom.top));
        else if (top.bottom < bottom.top && view.elementAtHeight((top.bottom + bottom.top) / 2).type == BlockType.Text)
            top.bottom = bottom.top = (top.bottom + bottom.top) / 2;
        return pieces(top).concat(between).concat(pieces(bottom));
    }
    function piece(left, top, right, bottom) {
        return new RectangleMarker(className, left - base.left, top - base.top - 0.01 /* C.Epsilon */, right - left, bottom - top + 0.01 /* C.Epsilon */);
    }
    function pieces({ top, bottom, horizontal }) {
        let pieces = [];
        for (let i = 0; i < horizontal.length; i += 2)
            pieces.push(piece(horizontal[i], top, horizontal[i + 1], bottom));
        return pieces;
    }
    // Gets passed from/to in line-local positions
    function drawForLine(from, to, line) {
        let top = 1e9, bottom = -1e9, horizontal = [];
        function addSpan(from, fromOpen, to, toOpen, dir) {
            // Passing 2/-2 is a kludge to force the view to return
            // coordinates on the proper side of block widgets, since
            // normalizing the side there, though appropriate for most
            // coordsAtPos queries, would break selection drawing.
            let fromCoords = view.coordsAtPos(from, (from == line.to ? -2 : 2));
            let toCoords = view.coordsAtPos(to, (to == line.from ? 2 : -2));
            if (!fromCoords || !toCoords)
                return;
            top = Math.min(fromCoords.top, toCoords.top, top);
            bottom = Math.max(fromCoords.bottom, toCoords.bottom, bottom);
            if (dir == Direction.LTR)
                horizontal.push(ltr && fromOpen ? leftSide : fromCoords.left, ltr && toOpen ? rightSide : toCoords.right);
            else
                horizontal.push(!ltr && toOpen ? leftSide : toCoords.left, !ltr && fromOpen ? rightSide : fromCoords.right);
        }
        let start = from !== null && from !== void 0 ? from : line.from, end = to !== null && to !== void 0 ? to : line.to;
        // Split the range by visible range and document line
        for (let r of view.visibleRanges)
            if (r.to > start && r.from < end) {
                for (let pos = Math.max(r.from, start), endPos = Math.min(r.to, end);;) {
                    let docLine = view.state.doc.lineAt(pos);
                    for (let span of view.bidiSpans(docLine)) {
                        let spanFrom = span.from + docLine.from, spanTo = span.to + docLine.from;
                        if (spanFrom >= endPos)
                            break;
                        if (spanTo > pos)
                            addSpan(Math.max(spanFrom, pos), from == null && spanFrom <= start, Math.min(spanTo, endPos), to == null && spanTo >= end, span.dir);
                    }
                    pos = docLine.to + 1;
                    if (pos >= endPos)
                        break;
                }
            }
        if (horizontal.length == 0)
            addSpan(start, from == null, end, to == null, view.textDirection);
        return { top, bottom, horizontal };
    }
    function drawForWidget(block, top) {
        let y = contentRect.top + (top ? block.top : block.bottom);
        return { top: y, bottom: y, horizontal: [] };
    }
}
function sameMarker(a, b) {
    return a.constructor == b.constructor && a.eq(b);
}
class LayerView {
    constructor(view, layer) {
        this.view = view;
        this.layer = layer;
        this.drawn = [];
        this.scaleX = 1;
        this.scaleY = 1;
        this.measureReq = { read: this.measure.bind(this), write: this.draw.bind(this) };
        this.dom = view.scrollDOM.appendChild(document.createElement("div"));
        this.dom.classList.add("cm-layer");
        if (layer.above)
            this.dom.classList.add("cm-layer-above");
        if (layer.class)
            this.dom.classList.add(layer.class);
        this.scale();
        this.dom.setAttribute("aria-hidden", "true");
        this.setOrder(view.state);
        view.requestMeasure(this.measureReq);
        if (layer.mount)
            layer.mount(this.dom, view);
    }
    update(update) {
        if (update.startState.facet(layerOrder) != update.state.facet(layerOrder))
            this.setOrder(update.state);
        if (this.layer.update(update, this.dom) || update.geometryChanged) {
            this.scale();
            update.view.requestMeasure(this.measureReq);
        }
    }
    docViewUpdate(view) {
        if (this.layer.updateOnDocViewUpdate !== false)
            view.requestMeasure(this.measureReq);
    }
    setOrder(state) {
        let pos = 0, order = state.facet(layerOrder);
        while (pos < order.length && order[pos] != this.layer)
            pos++;
        this.dom.style.zIndex = String((this.layer.above ? 150 : -1) - pos);
    }
    measure() {
        return this.layer.markers(this.view);
    }
    scale() {
        let { scaleX, scaleY } = this.view;
        if (scaleX != this.scaleX || scaleY != this.scaleY) {
            this.scaleX = scaleX;
            this.scaleY = scaleY;
            this.dom.style.transform = `scale(${1 / scaleX}, ${1 / scaleY})`;
        }
    }
    draw(markers) {
        if (markers.length != this.drawn.length || markers.some((p, i) => !sameMarker(p, this.drawn[i]))) {
            let old = this.dom.firstChild, oldI = 0;
            for (let marker of markers) {
                if (marker.update && old && marker.constructor && this.drawn[oldI].constructor &&
                    marker.update(old, this.drawn[oldI])) {
                    old = old.nextSibling;
                    oldI++;
                }
                else {
                    this.dom.insertBefore(marker.draw(), old);
                }
            }
            while (old) {
                let next = old.nextSibling;
                old.remove();
                old = next;
            }
            this.drawn = markers;
        }
    }
    destroy() {
        if (this.layer.destroy)
            this.layer.destroy(this.dom, this.view);
        this.dom.remove();
    }
}
const layerOrder = /*@__PURE__*/Facet.define();
/**
Define a layer.
*/
function layer(config) {
    return [
        ViewPlugin.define(v => new LayerView(v, config)),
        layerOrder.of(config)
    ];
}

const CanHidePrimary = !browser.ios; // FIXME test IE
const selectionConfig = /*@__PURE__*/Facet.define({
    combine(configs) {
        return combineConfig(configs, {
            cursorBlinkRate: 1200,
            drawRangeCursor: true
        }, {
            cursorBlinkRate: (a, b) => Math.min(a, b),
            drawRangeCursor: (a, b) => a || b
        });
    }
});
/**
Returns an extension that hides the browser's native selection and
cursor, replacing the selection with a background behind the text
(with the `cm-selectionBackground` class), and the
cursors with elements overlaid over the code (using
`cm-cursor-primary` and `cm-cursor-secondary`).

This allows the editor to display secondary selection ranges, and
tends to produce a type of selection more in line with that users
expect in a text editor (the native selection styling will often
leave gaps between lines and won't fill the horizontal space after
a line when the selection continues past it).

It does have a performance cost, in that it requires an extra DOM
layout cycle for many updates (the selection is drawn based on DOM
layout information that's only available after laying out the
content).
*/
function drawSelection(config = {}) {
    return [
        selectionConfig.of(config),
        cursorLayer,
        selectionLayer,
        hideNativeSelection,
        nativeSelectionHidden.of(true)
    ];
}
function configChanged(update) {
    return update.startState.facet(selectionConfig) != update.state.facet(selectionConfig);
}
const cursorLayer = /*@__PURE__*/layer({
    above: true,
    markers(view) {
        let { state } = view, conf = state.facet(selectionConfig);
        let cursors = [];
        for (let r of state.selection.ranges) {
            let prim = r == state.selection.main;
            if (r.empty ? !prim || CanHidePrimary : conf.drawRangeCursor) {
                let className = prim ? "cm-cursor cm-cursor-primary" : "cm-cursor cm-cursor-secondary";
                let cursor = r.empty ? r : EditorSelection.cursor(r.head, r.head > r.anchor ? -1 : 1);
                for (let piece of RectangleMarker.forRange(view, className, cursor))
                    cursors.push(piece);
            }
        }
        return cursors;
    },
    update(update, dom) {
        if (update.transactions.some(tr => tr.selection))
            dom.style.animationName = dom.style.animationName == "cm-blink" ? "cm-blink2" : "cm-blink";
        let confChange = configChanged(update);
        if (confChange)
            setBlinkRate(update.state, dom);
        return update.docChanged || update.selectionSet || confChange;
    },
    mount(dom, view) {
        setBlinkRate(view.state, dom);
    },
    class: "cm-cursorLayer"
});
function setBlinkRate(state, dom) {
    dom.style.animationDuration = state.facet(selectionConfig).cursorBlinkRate + "ms";
}
const selectionLayer = /*@__PURE__*/layer({
    above: false,
    markers(view) {
        return view.state.selection.ranges.map(r => r.empty ? [] : RectangleMarker.forRange(view, "cm-selectionBackground", r))
            .reduce((a, b) => a.concat(b));
    },
    update(update, dom) {
        return update.docChanged || update.selectionSet || update.viewportChanged || configChanged(update);
    },
    class: "cm-selectionLayer"
});
const themeSpec = {
    ".cm-line": {
        "& ::selection, &::selection": { backgroundColor: "transparent !important" },
    },
    ".cm-content": {
        "& :focus": {
            caretColor: "initial !important",
            "&::selection, & ::selection": {
                backgroundColor: "Highlight !important"
            }
        }
    }
};
if (CanHidePrimary)
    themeSpec[".cm-line"].caretColor = themeSpec[".cm-content"].caretColor = "transparent !important";
const hideNativeSelection = /*@__PURE__*/Prec.highest(/*@__PURE__*/EditorView.theme(themeSpec));

const setDropCursorPos = /*@__PURE__*/StateEffect.define({
    map(pos, mapping) { return pos == null ? null : mapping.mapPos(pos); }
});
const dropCursorPos = /*@__PURE__*/StateField.define({
    create() { return null; },
    update(pos, tr) {
        if (pos != null)
            pos = tr.changes.mapPos(pos);
        return tr.effects.reduce((pos, e) => e.is(setDropCursorPos) ? e.value : pos, pos);
    }
});
const drawDropCursor = /*@__PURE__*/ViewPlugin.fromClass(class {
    constructor(view) {
        this.view = view;
        this.cursor = null;
        this.measureReq = { read: this.readPos.bind(this), write: this.drawCursor.bind(this) };
    }
    update(update) {
        var _a;
        let cursorPos = update.state.field(dropCursorPos);
        if (cursorPos == null) {
            if (this.cursor != null) {
                (_a = this.cursor) === null || _a === void 0 ? void 0 : _a.remove();
                this.cursor = null;
            }
        }
        else {
            if (!this.cursor) {
                this.cursor = this.view.scrollDOM.appendChild(document.createElement("div"));
                this.cursor.className = "cm-dropCursor";
            }
            if (update.startState.field(dropCursorPos) != cursorPos || update.docChanged || update.geometryChanged)
                this.view.requestMeasure(this.measureReq);
        }
    }
    readPos() {
        let { view } = this;
        let pos = view.state.field(dropCursorPos);
        let rect = pos != null && view.coordsAtPos(pos);
        if (!rect)
            return null;
        let outer = view.scrollDOM.getBoundingClientRect();
        return {
            left: rect.left - outer.left + view.scrollDOM.scrollLeft * view.scaleX,
            top: rect.top - outer.top + view.scrollDOM.scrollTop * view.scaleY,
            height: rect.bottom - rect.top
        };
    }
    drawCursor(pos) {
        if (this.cursor) {
            let { scaleX, scaleY } = this.view;
            if (pos) {
                this.cursor.style.left = pos.left / scaleX + "px";
                this.cursor.style.top = pos.top / scaleY + "px";
                this.cursor.style.height = pos.height / scaleY + "px";
            }
            else {
                this.cursor.style.left = "-100000px";
            }
        }
    }
    destroy() {
        if (this.cursor)
            this.cursor.remove();
    }
    setDropPos(pos) {
        if (this.view.state.field(dropCursorPos) != pos)
            this.view.dispatch({ effects: setDropCursorPos.of(pos) });
    }
}, {
    eventObservers: {
        dragover(event) {
            this.setDropPos(this.view.posAtCoords({ x: event.clientX, y: event.clientY }));
        },
        dragleave(event) {
            if (event.target == this.view.contentDOM || !this.view.contentDOM.contains(event.relatedTarget))
                this.setDropPos(null);
        },
        dragend() {
            this.setDropPos(null);
        },
        drop() {
            this.setDropPos(null);
        }
    }
});
/**
Draws a cursor at the current drop position when something is
dragged over the editor.
*/
function dropCursor() {
    return [dropCursorPos, drawDropCursor];
}

function iterMatches(doc, re, from, to, f) {
    re.lastIndex = 0;
    for (let cursor = doc.iterRange(from, to), pos = from, m; !cursor.next().done; pos += cursor.value.length) {
        if (!cursor.lineBreak)
            while (m = re.exec(cursor.value))
                f(pos + m.index, m);
    }
}
function matchRanges(view, maxLength) {
    let visible = view.visibleRanges;
    if (visible.length == 1 && visible[0].from == view.viewport.from &&
        visible[0].to == view.viewport.to)
        return visible;
    let result = [];
    for (let { from, to } of visible) {
        from = Math.max(view.state.doc.lineAt(from).from, from - maxLength);
        to = Math.min(view.state.doc.lineAt(to).to, to + maxLength);
        if (result.length && result[result.length - 1].to >= from)
            result[result.length - 1].to = to;
        else
            result.push({ from, to });
    }
    return result;
}
/**
Helper class used to make it easier to maintain decorations on
visible code that matches a given regular expression. To be used
in a [view plugin](https://codemirror.net/6/docs/ref/#view.ViewPlugin). Instances of this object
represent a matching configuration.
*/
class MatchDecorator {
    /**
    Create a decorator.
    */
    constructor(config) {
        const { regexp, decoration, decorate, boundary, maxLength = 1000 } = config;
        if (!regexp.global)
            throw new RangeError("The regular expression given to MatchDecorator should have its 'g' flag set");
        this.regexp = regexp;
        if (decorate) {
            this.addMatch = (match, view, from, add) => decorate(add, from, from + match[0].length, match, view);
        }
        else if (typeof decoration == "function") {
            this.addMatch = (match, view, from, add) => {
                let deco = decoration(match, view, from);
                if (deco)
                    add(from, from + match[0].length, deco);
            };
        }
        else if (decoration) {
            this.addMatch = (match, _view, from, add) => add(from, from + match[0].length, decoration);
        }
        else {
            throw new RangeError("Either 'decorate' or 'decoration' should be provided to MatchDecorator");
        }
        this.boundary = boundary;
        this.maxLength = maxLength;
    }
    /**
    Compute the full set of decorations for matches in the given
    view's viewport. You'll want to call this when initializing your
    plugin.
    */
    createDeco(view) {
        let build = new RangeSetBuilder(), add = build.add.bind(build);
        for (let { from, to } of matchRanges(view, this.maxLength))
            iterMatches(view.state.doc, this.regexp, from, to, (from, m) => this.addMatch(m, view, from, add));
        return build.finish();
    }
    /**
    Update a set of decorations for a view update. `deco` _must_ be
    the set of decorations produced by _this_ `MatchDecorator` for
    the view state before the update.
    */
    updateDeco(update, deco) {
        let changeFrom = 1e9, changeTo = -1;
        if (update.docChanged)
            update.changes.iterChanges((_f, _t, from, to) => {
                if (to > update.view.viewport.from && from < update.view.viewport.to) {
                    changeFrom = Math.min(from, changeFrom);
                    changeTo = Math.max(to, changeTo);
                }
            });
        if (update.viewportChanged || changeTo - changeFrom > 1000)
            return this.createDeco(update.view);
        if (changeTo > -1)
            return this.updateRange(update.view, deco.map(update.changes), changeFrom, changeTo);
        return deco;
    }
    updateRange(view, deco, updateFrom, updateTo) {
        for (let r of view.visibleRanges) {
            let from = Math.max(r.from, updateFrom), to = Math.min(r.to, updateTo);
            if (to > from) {
                let fromLine = view.state.doc.lineAt(from), toLine = fromLine.to < to ? view.state.doc.lineAt(to) : fromLine;
                let start = Math.max(r.from, fromLine.from), end = Math.min(r.to, toLine.to);
                if (this.boundary) {
                    for (; from > fromLine.from; from--)
                        if (this.boundary.test(fromLine.text[from - 1 - fromLine.from])) {
                            start = from;
                            break;
                        }
                    for (; to < toLine.to; to++)
                        if (this.boundary.test(toLine.text[to - toLine.from])) {
                            end = to;
                            break;
                        }
                }
                let ranges = [], m;
                let add = (from, to, deco) => ranges.push(deco.range(from, to));
                if (fromLine == toLine) {
                    this.regexp.lastIndex = start - fromLine.from;
                    while ((m = this.regexp.exec(fromLine.text)) && m.index < end - fromLine.from)
                        this.addMatch(m, view, m.index + fromLine.from, add);
                }
                else {
                    iterMatches(view.state.doc, this.regexp, start, end, (from, m) => this.addMatch(m, view, from, add));
                }
                deco = deco.update({ filterFrom: start, filterTo: end, filter: (from, to) => from < start || to > end, add: ranges });
            }
        }
        return deco;
    }
}

const UnicodeRegexpSupport = /x/.unicode != null ? "gu" : "g";
const Specials = /*@__PURE__*/new RegExp("[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200e\u200f\u2028\u2029\u202d\u202e\u2066\u2067\u2069\ufeff\ufff9-\ufffc]", UnicodeRegexpSupport);
const Names = {
    0: "null",
    7: "bell",
    8: "backspace",
    10: "newline",
    11: "vertical tab",
    13: "carriage return",
    27: "escape",
    8203: "zero width space",
    8204: "zero width non-joiner",
    8205: "zero width joiner",
    8206: "left-to-right mark",
    8207: "right-to-left mark",
    8232: "line separator",
    8237: "left-to-right override",
    8238: "right-to-left override",
    8294: "left-to-right isolate",
    8295: "right-to-left isolate",
    8297: "pop directional isolate",
    8233: "paragraph separator",
    65279: "zero width no-break space",
    65532: "object replacement"
};
let _supportsTabSize = null;
function supportsTabSize() {
    var _a;
    if (_supportsTabSize == null && typeof document != "undefined" && document.body) {
        let styles = document.body.style;
        _supportsTabSize = ((_a = styles.tabSize) !== null && _a !== void 0 ? _a : styles.MozTabSize) != null;
    }
    return _supportsTabSize || false;
}
const specialCharConfig = /*@__PURE__*/Facet.define({
    combine(configs) {
        let config = combineConfig(configs, {
            render: null,
            specialChars: Specials,
            addSpecialChars: null
        });
        if (config.replaceTabs = !supportsTabSize())
            config.specialChars = new RegExp("\t|" + config.specialChars.source, UnicodeRegexpSupport);
        if (config.addSpecialChars)
            config.specialChars = new RegExp(config.specialChars.source + "|" + config.addSpecialChars.source, UnicodeRegexpSupport);
        return config;
    }
});
/**
Returns an extension that installs highlighting of special
characters.
*/
function highlightSpecialChars(
/**
Configuration options.
*/
config = {}) {
    return [specialCharConfig.of(config), specialCharPlugin()];
}
let _plugin = null;
function specialCharPlugin() {
    return _plugin || (_plugin = ViewPlugin.fromClass(class {
        constructor(view) {
            this.view = view;
            this.decorations = Decoration.none;
            this.decorationCache = Object.create(null);
            this.decorator = this.makeDecorator(view.state.facet(specialCharConfig));
            this.decorations = this.decorator.createDeco(view);
        }
        makeDecorator(conf) {
            return new MatchDecorator({
                regexp: conf.specialChars,
                decoration: (m, view, pos) => {
                    let { doc } = view.state;
                    let code = codePointAt(m[0], 0);
                    if (code == 9) {
                        let line = doc.lineAt(pos);
                        let size = view.state.tabSize, col = countColumn(line.text, size, pos - line.from);
                        return Decoration.replace({
                            widget: new TabWidget((size - (col % size)) * this.view.defaultCharacterWidth / this.view.scaleX)
                        });
                    }
                    return this.decorationCache[code] ||
                        (this.decorationCache[code] = Decoration.replace({ widget: new SpecialCharWidget(conf, code) }));
                },
                boundary: conf.replaceTabs ? undefined : /[^]/
            });
        }
        update(update) {
            let conf = update.state.facet(specialCharConfig);
            if (update.startState.facet(specialCharConfig) != conf) {
                this.decorator = this.makeDecorator(conf);
                this.decorations = this.decorator.createDeco(update.view);
            }
            else {
                this.decorations = this.decorator.updateDeco(update, this.decorations);
            }
        }
    }, {
        decorations: v => v.decorations
    }));
}
const DefaultPlaceholder = "\u2022";
// Assigns placeholder characters from the Control Pictures block to
// ASCII control characters
function placeholder$1(code) {
    if (code >= 32)
        return DefaultPlaceholder;
    if (code == 10)
        return "\u2424";
    return String.fromCharCode(9216 + code);
}
class SpecialCharWidget extends WidgetType {
    constructor(options, code) {
        super();
        this.options = options;
        this.code = code;
    }
    eq(other) { return other.code == this.code; }
    toDOM(view) {
        let ph = placeholder$1(this.code);
        let desc = view.state.phrase("Control character") + " " + (Names[this.code] || "0x" + this.code.toString(16));
        let custom = this.options.render && this.options.render(this.code, desc, ph);
        if (custom)
            return custom;
        let span = document.createElement("span");
        span.textContent = ph;
        span.title = desc;
        span.setAttribute("aria-label", desc);
        span.className = "cm-specialChar";
        return span;
    }
    ignoreEvent() { return false; }
}
class TabWidget extends WidgetType {
    constructor(width) {
        super();
        this.width = width;
    }
    eq(other) { return other.width == this.width; }
    toDOM() {
        let span = document.createElement("span");
        span.textContent = "\t";
        span.className = "cm-tab";
        span.style.width = this.width + "px";
        return span;
    }
    ignoreEvent() { return false; }
}

/**
Mark lines that have a cursor on them with the `"cm-activeLine"`
DOM class.
*/
function highlightActiveLine() {
    return activeLineHighlighter;
}
const lineDeco = /*@__PURE__*/Decoration.line({ class: "cm-activeLine" });
const activeLineHighlighter = /*@__PURE__*/ViewPlugin.fromClass(class {
    constructor(view) {
        this.decorations = this.getDeco(view);
    }
    update(update) {
        if (update.docChanged || update.selectionSet)
            this.decorations = this.getDeco(update.view);
    }
    getDeco(view) {
        let lastLineStart = -1, deco = [];
        for (let r of view.state.selection.ranges) {
            let line = view.lineBlockAt(r.head);
            if (line.from > lastLineStart) {
                deco.push(lineDeco.range(line.from));
                lastLineStart = line.from;
            }
        }
        return Decoration.set(deco);
    }
}, {
    decorations: v => v.decorations
});

// Don't compute precise column positions for line offsets above this
// (since it could get expensive). Assume offset==column for them.
const MaxOff = 2000;
function rectangleFor(state, a, b) {
    let startLine = Math.min(a.line, b.line), endLine = Math.max(a.line, b.line);
    let ranges = [];
    if (a.off > MaxOff || b.off > MaxOff || a.col < 0 || b.col < 0) {
        let startOff = Math.min(a.off, b.off), endOff = Math.max(a.off, b.off);
        for (let i = startLine; i <= endLine; i++) {
            let line = state.doc.line(i);
            if (line.length <= endOff)
                ranges.push(EditorSelection.range(line.from + startOff, line.to + endOff));
        }
    }
    else {
        let startCol = Math.min(a.col, b.col), endCol = Math.max(a.col, b.col);
        for (let i = startLine; i <= endLine; i++) {
            let line = state.doc.line(i);
            let start = findColumn(line.text, startCol, state.tabSize, true);
            if (start < 0) {
                ranges.push(EditorSelection.cursor(line.to));
            }
            else {
                let end = findColumn(line.text, endCol, state.tabSize);
                ranges.push(EditorSelection.range(line.from + start, line.from + end));
            }
        }
    }
    return ranges;
}
function absoluteColumn(view, x) {
    let ref = view.coordsAtPos(view.viewport.from);
    return ref ? Math.round(Math.abs((ref.left - x) / view.defaultCharacterWidth)) : -1;
}
function getPos(view, event) {
    let offset = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    let line = view.state.doc.lineAt(offset), off = offset - line.from;
    let col = off > MaxOff ? -1
        : off == line.length ? absoluteColumn(view, event.clientX)
            : countColumn(line.text, view.state.tabSize, offset - line.from);
    return { line: line.number, col, off };
}
function rectangleSelectionStyle(view, event) {
    let start = getPos(view, event), startSel = view.state.selection;
    if (!start)
        return null;
    return {
        update(update) {
            if (update.docChanged) {
                let newStart = update.changes.mapPos(update.startState.doc.line(start.line).from);
                let newLine = update.state.doc.lineAt(newStart);
                start = { line: newLine.number, col: start.col, off: Math.min(start.off, newLine.length) };
                startSel = startSel.map(update.changes);
            }
        },
        get(event, _extend, multiple) {
            let cur = getPos(view, event);
            if (!cur)
                return startSel;
            let ranges = rectangleFor(view.state, start, cur);
            if (!ranges.length)
                return startSel;
            if (multiple)
                return EditorSelection.create(ranges.concat(startSel.ranges));
            else
                return EditorSelection.create(ranges);
        }
    };
}
/**
Create an extension that enables rectangular selections. By
default, it will react to left mouse drag with the Alt key held
down. When such a selection occurs, the text within the rectangle
that was dragged over will be selected, as one selection
[range](https://codemirror.net/6/docs/ref/#state.SelectionRange) per line.
*/
function rectangularSelection(options) {
    let filter = (e => e.altKey && e.button == 0);
    return EditorView.mouseSelectionStyle.of((view, event) => filter(event) ? rectangleSelectionStyle(view, event) : null);
}
const keys = {
    Alt: [18, e => !!e.altKey],
    Control: [17, e => !!e.ctrlKey],
    Shift: [16, e => !!e.shiftKey],
    Meta: [91, e => !!e.metaKey]
};
const showCrosshair = { style: "cursor: crosshair" };
/**
Returns an extension that turns the pointer cursor into a
crosshair when a given modifier key, defaulting to Alt, is held
down. Can serve as a visual hint that rectangular selection is
going to happen when paired with
[`rectangularSelection`](https://codemirror.net/6/docs/ref/#view.rectangularSelection).
*/
function crosshairCursor(options = {}) {
    let [code, getter] = keys[options.key || "Alt"];
    let plugin = ViewPlugin.fromClass(class {
        constructor(view) {
            this.view = view;
            this.isDown = false;
        }
        set(isDown) {
            if (this.isDown != isDown) {
                this.isDown = isDown;
                this.view.update([]);
            }
        }
    }, {
        eventObservers: {
            keydown(e) {
                this.set(e.keyCode == code || getter(e));
            },
            keyup(e) {
                if (e.keyCode == code || !getter(e))
                    this.set(false);
            },
            mousemove(e) {
                this.set(getter(e));
            }
        }
    });
    return [
        plugin,
        EditorView.contentAttributes.of(view => { var _a; return ((_a = view.plugin(plugin)) === null || _a === void 0 ? void 0 : _a.isDown) ? showCrosshair : null; })
    ];
}

/**
A gutter marker represents a bit of information attached to a line
in a specific gutter. Your own custom markers have to extend this
class.
*/
class GutterMarker extends RangeValue {
    /**
    @internal
    */
    compare(other) {
        return this == other || this.constructor == other.constructor && this.eq(other);
    }
    /**
    Compare this marker to another marker of the same type.
    */
    eq(other) { return false; }
    /**
    Called if the marker has a `toDOM` method and its representation
    was removed from a gutter.
    */
    destroy(dom) { }
}
GutterMarker.prototype.elementClass = "";
GutterMarker.prototype.toDOM = undefined;
GutterMarker.prototype.mapMode = MapMode.TrackBefore;
GutterMarker.prototype.startSide = GutterMarker.prototype.endSide = -1;
GutterMarker.prototype.point = true;
/**
Facet used to add a class to all gutter elements for a given line.
Markers given to this facet should _only_ define an
[`elementclass`](https://codemirror.net/6/docs/ref/#view.GutterMarker.elementClass), not a
[`toDOM`](https://codemirror.net/6/docs/ref/#view.GutterMarker.toDOM) (or the marker will appear
in all gutters for the line).
*/
const gutterLineClass = /*@__PURE__*/Facet.define();
const defaults = {
    class: "",
    renderEmptyElements: false,
    elementStyle: "",
    markers: () => RangeSet.empty,
    lineMarker: () => null,
    widgetMarker: () => null,
    lineMarkerChange: null,
    initialSpacer: null,
    updateSpacer: null,
    domEventHandlers: {}
};
const activeGutters = /*@__PURE__*/Facet.define();
/**
Define an editor gutter. The order in which the gutters appear is
determined by their extension priority.
*/
function gutter(config) {
    return [gutters(), activeGutters.of(Object.assign(Object.assign({}, defaults), config))];
}
const unfixGutters = /*@__PURE__*/Facet.define({
    combine: values => values.some(x => x)
});
/**
The gutter-drawing plugin is automatically enabled when you add a
gutter, but you can use this function to explicitly configure it.

Unless `fixed` is explicitly set to `false`, the gutters are
fixed, meaning they don't scroll along with the content
horizontally (except on Internet Explorer, which doesn't support
CSS [`position:
sticky`](https://developer.mozilla.org/en-US/docs/Web/CSS/position#sticky)).
*/
function gutters(config) {
    let result = [
        gutterView,
    ];
    return result;
}
const gutterView = /*@__PURE__*/ViewPlugin.fromClass(class {
    constructor(view) {
        this.view = view;
        this.prevViewport = view.viewport;
        this.dom = document.createElement("div");
        this.dom.className = "cm-gutters";
        this.dom.setAttribute("aria-hidden", "true");
        this.dom.style.minHeight = (this.view.contentHeight / this.view.scaleY) + "px";
        this.gutters = view.state.facet(activeGutters).map(conf => new SingleGutterView(view, conf));
        for (let gutter of this.gutters)
            this.dom.appendChild(gutter.dom);
        this.fixed = !view.state.facet(unfixGutters);
        if (this.fixed) {
            // FIXME IE11 fallback, which doesn't support position: sticky,
            // by using position: relative + event handlers that realign the
            // gutter (or just force fixed=false on IE11?)
            this.dom.style.position = "sticky";
        }
        this.syncGutters(false);
        view.scrollDOM.insertBefore(this.dom, view.contentDOM);
    }
    update(update) {
        if (this.updateGutters(update)) {
            // Detach during sync when the viewport changed significantly
            // (such as during scrolling), since for large updates that is
            // faster.
            let vpA = this.prevViewport, vpB = update.view.viewport;
            let vpOverlap = Math.min(vpA.to, vpB.to) - Math.max(vpA.from, vpB.from);
            this.syncGutters(vpOverlap < (vpB.to - vpB.from) * 0.8);
        }
        if (update.geometryChanged) {
            this.dom.style.minHeight = (this.view.contentHeight / this.view.scaleY) + "px";
        }
        if (this.view.state.facet(unfixGutters) != !this.fixed) {
            this.fixed = !this.fixed;
            this.dom.style.position = this.fixed ? "sticky" : "";
        }
        this.prevViewport = update.view.viewport;
    }
    syncGutters(detach) {
        let after = this.dom.nextSibling;
        if (detach)
            this.dom.remove();
        let lineClasses = RangeSet.iter(this.view.state.facet(gutterLineClass), this.view.viewport.from);
        let classSet = [];
        let contexts = this.gutters.map(gutter => new UpdateContext(gutter, this.view.viewport, -this.view.documentPadding.top));
        for (let line of this.view.viewportLineBlocks) {
            if (classSet.length)
                classSet = [];
            if (Array.isArray(line.type)) {
                let first = true;
                for (let b of line.type) {
                    if (b.type == BlockType.Text && first) {
                        advanceCursor(lineClasses, classSet, b.from);
                        for (let cx of contexts)
                            cx.line(this.view, b, classSet);
                        first = false;
                    }
                    else if (b.widget) {
                        for (let cx of contexts)
                            cx.widget(this.view, b);
                    }
                }
            }
            else if (line.type == BlockType.Text) {
                advanceCursor(lineClasses, classSet, line.from);
                for (let cx of contexts)
                    cx.line(this.view, line, classSet);
            }
            else if (line.widget) {
                for (let cx of contexts)
                    cx.widget(this.view, line);
            }
        }
        for (let cx of contexts)
            cx.finish();
        if (detach)
            this.view.scrollDOM.insertBefore(this.dom, after);
    }
    updateGutters(update) {
        let prev = update.startState.facet(activeGutters), cur = update.state.facet(activeGutters);
        let change = update.docChanged || update.heightChanged || update.viewportChanged ||
            !RangeSet.eq(update.startState.facet(gutterLineClass), update.state.facet(gutterLineClass), update.view.viewport.from, update.view.viewport.to);
        if (prev == cur) {
            for (let gutter of this.gutters)
                if (gutter.update(update))
                    change = true;
        }
        else {
            change = true;
            let gutters = [];
            for (let conf of cur) {
                let known = prev.indexOf(conf);
                if (known < 0) {
                    gutters.push(new SingleGutterView(this.view, conf));
                }
                else {
                    this.gutters[known].update(update);
                    gutters.push(this.gutters[known]);
                }
            }
            for (let g of this.gutters) {
                g.dom.remove();
                if (gutters.indexOf(g) < 0)
                    g.destroy();
            }
            for (let g of gutters)
                this.dom.appendChild(g.dom);
            this.gutters = gutters;
        }
        return change;
    }
    destroy() {
        for (let view of this.gutters)
            view.destroy();
        this.dom.remove();
    }
}, {
    provide: plugin => EditorView.scrollMargins.of(view => {
        let value = view.plugin(plugin);
        if (!value || value.gutters.length == 0 || !value.fixed)
            return null;
        return view.textDirection == Direction.LTR
            ? { left: value.dom.offsetWidth * view.scaleX }
            : { right: value.dom.offsetWidth * view.scaleX };
    })
});
function asArray(val) { return (Array.isArray(val) ? val : [val]); }
function advanceCursor(cursor, collect, pos) {
    while (cursor.value && cursor.from <= pos) {
        if (cursor.from == pos)
            collect.push(cursor.value);
        cursor.next();
    }
}
class UpdateContext {
    constructor(gutter, viewport, height) {
        this.gutter = gutter;
        this.height = height;
        this.i = 0;
        this.cursor = RangeSet.iter(gutter.markers, viewport.from);
    }
    addElement(view, block, markers) {
        let { gutter } = this, above = (block.top - this.height) / view.scaleY, height = block.height / view.scaleY;
        if (this.i == gutter.elements.length) {
            let newElt = new GutterElement(view, height, above, markers);
            gutter.elements.push(newElt);
            gutter.dom.appendChild(newElt.dom);
        }
        else {
            gutter.elements[this.i].update(view, height, above, markers);
        }
        this.height = block.bottom;
        this.i++;
    }
    line(view, line, extraMarkers) {
        let localMarkers = [];
        advanceCursor(this.cursor, localMarkers, line.from);
        if (extraMarkers.length)
            localMarkers = localMarkers.concat(extraMarkers);
        let forLine = this.gutter.config.lineMarker(view, line, localMarkers);
        if (forLine)
            localMarkers.unshift(forLine);
        let gutter = this.gutter;
        if (localMarkers.length == 0 && !gutter.config.renderEmptyElements)
            return;
        this.addElement(view, line, localMarkers);
    }
    widget(view, block) {
        let marker = this.gutter.config.widgetMarker(view, block.widget, block);
        if (marker)
            this.addElement(view, block, [marker]);
    }
    finish() {
        let gutter = this.gutter;
        while (gutter.elements.length > this.i) {
            let last = gutter.elements.pop();
            gutter.dom.removeChild(last.dom);
            last.destroy();
        }
    }
}
class SingleGutterView {
    constructor(view, config) {
        this.view = view;
        this.config = config;
        this.elements = [];
        this.spacer = null;
        this.dom = document.createElement("div");
        this.dom.className = "cm-gutter" + (this.config.class ? " " + this.config.class : "");
        for (let prop in config.domEventHandlers) {
            this.dom.addEventListener(prop, (event) => {
                let target = event.target, y;
                if (target != this.dom && this.dom.contains(target)) {
                    while (target.parentNode != this.dom)
                        target = target.parentNode;
                    let rect = target.getBoundingClientRect();
                    y = (rect.top + rect.bottom) / 2;
                }
                else {
                    y = event.clientY;
                }
                let line = view.lineBlockAtHeight(y - view.documentTop);
                if (config.domEventHandlers[prop](view, line, event))
                    event.preventDefault();
            });
        }
        this.markers = asArray(config.markers(view));
        if (config.initialSpacer) {
            this.spacer = new GutterElement(view, 0, 0, [config.initialSpacer(view)]);
            this.dom.appendChild(this.spacer.dom);
            this.spacer.dom.style.cssText += "visibility: hidden; pointer-events: none";
        }
    }
    update(update) {
        let prevMarkers = this.markers;
        this.markers = asArray(this.config.markers(update.view));
        if (this.spacer && this.config.updateSpacer) {
            let updated = this.config.updateSpacer(this.spacer.markers[0], update);
            if (updated != this.spacer.markers[0])
                this.spacer.update(update.view, 0, 0, [updated]);
        }
        let vp = update.view.viewport;
        return !RangeSet.eq(this.markers, prevMarkers, vp.from, vp.to) ||
            (this.config.lineMarkerChange ? this.config.lineMarkerChange(update) : false);
    }
    destroy() {
        for (let elt of this.elements)
            elt.destroy();
    }
}
class GutterElement {
    constructor(view, height, above, markers) {
        this.height = -1;
        this.above = 0;
        this.markers = [];
        this.dom = document.createElement("div");
        this.dom.className = "cm-gutterElement";
        this.update(view, height, above, markers);
    }
    update(view, height, above, markers) {
        if (this.height != height) {
            this.height = height;
            this.dom.style.height = height + "px";
        }
        if (this.above != above)
            this.dom.style.marginTop = (this.above = above) ? above + "px" : "";
        if (!sameMarkers(this.markers, markers))
            this.setMarkers(view, markers);
    }
    setMarkers(view, markers) {
        let cls = "cm-gutterElement", domPos = this.dom.firstChild;
        for (let iNew = 0, iOld = 0;;) {
            let skipTo = iOld, marker = iNew < markers.length ? markers[iNew++] : null, matched = false;
            if (marker) {
                let c = marker.elementClass;
                if (c)
                    cls += " " + c;
                for (let i = iOld; i < this.markers.length; i++)
                    if (this.markers[i].compare(marker)) {
                        skipTo = i;
                        matched = true;
                        break;
                    }
            }
            else {
                skipTo = this.markers.length;
            }
            while (iOld < skipTo) {
                let next = this.markers[iOld++];
                if (next.toDOM) {
                    next.destroy(domPos);
                    let after = domPos.nextSibling;
                    domPos.remove();
                    domPos = after;
                }
            }
            if (!marker)
                break;
            if (marker.toDOM) {
                if (matched)
                    domPos = domPos.nextSibling;
                else
                    this.dom.insertBefore(marker.toDOM(view), domPos);
            }
            if (matched)
                iOld++;
        }
        this.dom.className = cls;
        this.markers = markers;
    }
    destroy() {
        this.setMarkers(null, []); // First argument not used unless creating markers
    }
}
function sameMarkers(a, b) {
    if (a.length != b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (!a[i].compare(b[i]))
            return false;
    return true;
}
/**
Facet used to provide markers to the line number gutter.
*/
const lineNumberMarkers = /*@__PURE__*/Facet.define();
const lineNumberConfig = /*@__PURE__*/Facet.define({
    combine(values) {
        return combineConfig(values, { formatNumber: String, domEventHandlers: {} }, {
            domEventHandlers(a, b) {
                let result = Object.assign({}, a);
                for (let event in b) {
                    let exists = result[event], add = b[event];
                    result[event] = exists ? (view, line, event) => exists(view, line, event) || add(view, line, event) : add;
                }
                return result;
            }
        });
    }
});
class NumberMarker extends GutterMarker {
    constructor(number) {
        super();
        this.number = number;
    }
    eq(other) { return this.number == other.number; }
    toDOM() { return document.createTextNode(this.number); }
}
function formatNumber(view, number) {
    return view.state.facet(lineNumberConfig).formatNumber(number, view.state);
}
const lineNumberGutter = /*@__PURE__*/activeGutters.compute([lineNumberConfig], state => ({
    class: "cm-lineNumbers",
    renderEmptyElements: false,
    markers(view) { return view.state.facet(lineNumberMarkers); },
    lineMarker(view, line, others) {
        if (others.some(m => m.toDOM))
            return null;
        return new NumberMarker(formatNumber(view, view.state.doc.lineAt(line.from).number));
    },
    widgetMarker: () => null,
    lineMarkerChange: update => update.startState.facet(lineNumberConfig) != update.state.facet(lineNumberConfig),
    initialSpacer(view) {
        return new NumberMarker(formatNumber(view, maxLineNumber(view.state.doc.lines)));
    },
    updateSpacer(spacer, update) {
        let max = formatNumber(update.view, maxLineNumber(update.view.state.doc.lines));
        return max == spacer.number ? spacer : new NumberMarker(max);
    },
    domEventHandlers: state.facet(lineNumberConfig).domEventHandlers
}));
/**
Create a line number gutter extension.
*/
function lineNumbers(config = {}) {
    return [
        lineNumberConfig.of(config),
        gutters(),
        lineNumberGutter
    ];
}
function maxLineNumber(lines) {
    let last = 9;
    while (last < lines)
        last = last * 10 + 9;
    return last;
}
const activeLineGutterMarker = /*@__PURE__*/new class extends GutterMarker {
    constructor() {
        super(...arguments);
        this.elementClass = "cm-activeLineGutter";
    }
};
const activeLineGutterHighlighter = /*@__PURE__*/gutterLineClass.compute(["selection"], state => {
    let marks = [], last = -1;
    for (let range of state.selection.ranges) {
        let linePos = state.doc.lineAt(range.head).from;
        if (linePos > last) {
            last = linePos;
            marks.push(activeLineGutterMarker.range(linePos));
        }
    }
    return RangeSet.of(marks);
});
/**
Returns an extension that adds a `cm-activeLineGutter` class to
all gutter elements on the [active
line](https://codemirror.net/6/docs/ref/#view.highlightActiveLine).
*/
function highlightActiveLineGutter() {
    return activeLineGutterHighlighter;
}

/**
The default maximum length of a `TreeBuffer` node.
*/
const DefaultBufferLength = 1024;
let nextPropID = 0;
class Range {
    constructor(from, to) {
        this.from = from;
        this.to = to;
    }
}
/**
Each [node type](#common.NodeType) or [individual tree](#common.Tree)
can have metadata associated with it in props. Instances of this
class represent prop names.
*/
class NodeProp {
    /**
    Create a new node prop type.
    */
    constructor(config = {}) {
        this.id = nextPropID++;
        this.perNode = !!config.perNode;
        this.deserialize = config.deserialize || (() => {
            throw new Error("This node type doesn't define a deserialize function");
        });
    }
    /**
    This is meant to be used with
    [`NodeSet.extend`](#common.NodeSet.extend) or
    [`LRParser.configure`](#lr.ParserConfig.props) to compute
    prop values for each node type in the set. Takes a [match
    object](#common.NodeType^match) or function that returns undefined
    if the node type doesn't get this prop, and the prop's value if
    it does.
    */
    add(match) {
        if (this.perNode)
            throw new RangeError("Can't add per-node props to node types");
        if (typeof match != "function")
            match = NodeType.match(match);
        return (type) => {
            let result = match(type);
            return result === undefined ? null : [this, result];
        };
    }
}
/**
Prop that is used to describe matching delimiters. For opening
delimiters, this holds an array of node names (written as a
space-separated string when declaring this prop in a grammar)
for the node types of closing delimiters that match it.
*/
NodeProp.closedBy = new NodeProp({ deserialize: str => str.split(" ") });
/**
The inverse of [`closedBy`](#common.NodeProp^closedBy). This is
attached to closing delimiters, holding an array of node names
of types of matching opening delimiters.
*/
NodeProp.openedBy = new NodeProp({ deserialize: str => str.split(" ") });
/**
Used to assign node types to groups (for example, all node
types that represent an expression could be tagged with an
`"Expression"` group).
*/
NodeProp.group = new NodeProp({ deserialize: str => str.split(" ") });
/**
Attached to nodes to indicate these should be
[displayed](https://codemirror.net/docs/ref/#language.syntaxTree)
in a bidirectional text isolate, so that direction-neutral
characters on their sides don't incorrectly get associated with
surrounding text. You'll generally want to set this for nodes
that contain arbitrary text, like strings and comments, and for
nodes that appear _inside_ arbitrary text, like HTML tags. When
not given a value, in a grammar declaration, defaults to
`"auto"`.
*/
NodeProp.isolate = new NodeProp({ deserialize: value => {
        if (value && value != "rtl" && value != "ltr" && value != "auto")
            throw new RangeError("Invalid value for isolate: " + value);
        return value || "auto";
    } });
/**
The hash of the [context](#lr.ContextTracker.constructor)
that the node was parsed in, if any. Used to limit reuse of
contextual nodes.
*/
NodeProp.contextHash = new NodeProp({ perNode: true });
/**
The distance beyond the end of the node that the tokenizer
looked ahead for any of the tokens inside the node. (The LR
parser only stores this when it is larger than 25, for
efficiency reasons.)
*/
NodeProp.lookAhead = new NodeProp({ perNode: true });
/**
This per-node prop is used to replace a given node, or part of a
node, with another tree. This is useful to include trees from
different languages in mixed-language parsers.
*/
NodeProp.mounted = new NodeProp({ perNode: true });
/**
A mounted tree, which can be [stored](#common.NodeProp^mounted) on
a tree node to indicate that parts of its content are
represented by another tree.
*/
class MountedTree {
    constructor(
    /**
    The inner tree.
    */
    tree, 
    /**
    If this is null, this tree replaces the entire node (it will
    be included in the regular iteration instead of its host
    node). If not, only the given ranges are considered to be
    covered by this tree. This is used for trees that are mixed in
    a way that isn't strictly hierarchical. Such mounted trees are
    only entered by [`resolveInner`](#common.Tree.resolveInner)
    and [`enter`](#common.SyntaxNode.enter).
    */
    overlay, 
    /**
    The parser used to create this subtree.
    */
    parser) {
        this.tree = tree;
        this.overlay = overlay;
        this.parser = parser;
    }
    /**
    @internal
    */
    static get(tree) {
        return tree && tree.props && tree.props[NodeProp.mounted.id];
    }
}
const noProps = Object.create(null);
/**
Each node in a syntax tree has a node type associated with it.
*/
class NodeType {
    /**
    @internal
    */
    constructor(
    /**
    The name of the node type. Not necessarily unique, but if the
    grammar was written properly, different node types with the
    same name within a node set should play the same semantic
    role.
    */
    name, 
    /**
    @internal
    */
    props, 
    /**
    The id of this node in its set. Corresponds to the term ids
    used in the parser.
    */
    id, 
    /**
    @internal
    */
    flags = 0) {
        this.name = name;
        this.props = props;
        this.id = id;
        this.flags = flags;
    }
    /**
    Define a node type.
    */
    static define(spec) {
        let props = spec.props && spec.props.length ? Object.create(null) : noProps;
        let flags = (spec.top ? 1 /* NodeFlag.Top */ : 0) | (spec.skipped ? 2 /* NodeFlag.Skipped */ : 0) |
            (spec.error ? 4 /* NodeFlag.Error */ : 0) | (spec.name == null ? 8 /* NodeFlag.Anonymous */ : 0);
        let type = new NodeType(spec.name || "", props, spec.id, flags);
        if (spec.props)
            for (let src of spec.props) {
                if (!Array.isArray(src))
                    src = src(type);
                if (src) {
                    if (src[0].perNode)
                        throw new RangeError("Can't store a per-node prop on a node type");
                    props[src[0].id] = src[1];
                }
            }
        return type;
    }
    /**
    Retrieves a node prop for this type. Will return `undefined` if
    the prop isn't present on this node.
    */
    prop(prop) { return this.props[prop.id]; }
    /**
    True when this is the top node of a grammar.
    */
    get isTop() { return (this.flags & 1 /* NodeFlag.Top */) > 0; }
    /**
    True when this node is produced by a skip rule.
    */
    get isSkipped() { return (this.flags & 2 /* NodeFlag.Skipped */) > 0; }
    /**
    Indicates whether this is an error node.
    */
    get isError() { return (this.flags & 4 /* NodeFlag.Error */) > 0; }
    /**
    When true, this node type doesn't correspond to a user-declared
    named node, for example because it is used to cache repetition.
    */
    get isAnonymous() { return (this.flags & 8 /* NodeFlag.Anonymous */) > 0; }
    /**
    Returns true when this node's name or one of its
    [groups](#common.NodeProp^group) matches the given string.
    */
    is(name) {
        if (typeof name == 'string') {
            if (this.name == name)
                return true;
            let group = this.prop(NodeProp.group);
            return group ? group.indexOf(name) > -1 : false;
        }
        return this.id == name;
    }
    /**
    Create a function from node types to arbitrary values by
    specifying an object whose property names are node or
    [group](#common.NodeProp^group) names. Often useful with
    [`NodeProp.add`](#common.NodeProp.add). You can put multiple
    names, separated by spaces, in a single property name to map
    multiple node names to a single value.
    */
    static match(map) {
        let direct = Object.create(null);
        for (let prop in map)
            for (let name of prop.split(" "))
                direct[name] = map[prop];
        return (node) => {
            for (let groups = node.prop(NodeProp.group), i = -1; i < (groups ? groups.length : 0); i++) {
                let found = direct[i < 0 ? node.name : groups[i]];
                if (found)
                    return found;
            }
        };
    }
}
/**
An empty dummy node type to use when no actual type is available.
*/
NodeType.none = new NodeType("", Object.create(null), 0, 8 /* NodeFlag.Anonymous */);
/**
A node set holds a collection of node types. It is used to
compactly represent trees by storing their type ids, rather than a
full pointer to the type object, in a numeric array. Each parser
[has](#lr.LRParser.nodeSet) a node set, and [tree
buffers](#common.TreeBuffer) can only store collections of nodes
from the same set. A set can have a maximum of 2**16 (65536) node
types in it, so that the ids fit into 16-bit typed array slots.
*/
class NodeSet {
    /**
    Create a set with the given types. The `id` property of each
    type should correspond to its position within the array.
    */
    constructor(
    /**
    The node types in this set, by id.
    */
    types) {
        this.types = types;
        for (let i = 0; i < types.length; i++)
            if (types[i].id != i)
                throw new RangeError("Node type ids should correspond to array positions when creating a node set");
    }
    /**
    Create a copy of this set with some node properties added. The
    arguments to this method can be created with
    [`NodeProp.add`](#common.NodeProp.add).
    */
    extend(...props) {
        let newTypes = [];
        for (let type of this.types) {
            let newProps = null;
            for (let source of props) {
                let add = source(type);
                if (add) {
                    if (!newProps)
                        newProps = Object.assign({}, type.props);
                    newProps[add[0].id] = add[1];
                }
            }
            newTypes.push(newProps ? new NodeType(type.name, newProps, type.id, type.flags) : type);
        }
        return new NodeSet(newTypes);
    }
}
const CachedNode = new WeakMap(), CachedInnerNode = new WeakMap();
/**
Options that control iteration. Can be combined with the `|`
operator to enable multiple ones.
*/
var IterMode;
(function (IterMode) {
    /**
    When enabled, iteration will only visit [`Tree`](#common.Tree)
    objects, not nodes packed into
    [`TreeBuffer`](#common.TreeBuffer)s.
    */
    IterMode[IterMode["ExcludeBuffers"] = 1] = "ExcludeBuffers";
    /**
    Enable this to make iteration include anonymous nodes (such as
    the nodes that wrap repeated grammar constructs into a balanced
    tree).
    */
    IterMode[IterMode["IncludeAnonymous"] = 2] = "IncludeAnonymous";
    /**
    By default, regular [mounted](#common.NodeProp^mounted) nodes
    replace their base node in iteration. Enable this to ignore them
    instead.
    */
    IterMode[IterMode["IgnoreMounts"] = 4] = "IgnoreMounts";
    /**
    This option only applies in
    [`enter`](#common.SyntaxNode.enter)-style methods. It tells the
    library to not enter mounted overlays if one covers the given
    position.
    */
    IterMode[IterMode["IgnoreOverlays"] = 8] = "IgnoreOverlays";
})(IterMode || (IterMode = {}));
/**
A piece of syntax tree. There are two ways to approach these
trees: the way they are actually stored in memory, and the
convenient way.

Syntax trees are stored as a tree of `Tree` and `TreeBuffer`
objects. By packing detail information into `TreeBuffer` leaf
nodes, the representation is made a lot more memory-efficient.

However, when you want to actually work with tree nodes, this
representation is very awkward, so most client code will want to
use the [`TreeCursor`](#common.TreeCursor) or
[`SyntaxNode`](#common.SyntaxNode) interface instead, which provides
a view on some part of this data structure, and can be used to
move around to adjacent nodes.
*/
class Tree {
    /**
    Construct a new tree. See also [`Tree.build`](#common.Tree^build).
    */
    constructor(
    /**
    The type of the top node.
    */
    type, 
    /**
    This node's child nodes.
    */
    children, 
    /**
    The positions (offsets relative to the start of this tree) of
    the children.
    */
    positions, 
    /**
    The total length of this tree
    */
    length, 
    /**
    Per-node [node props](#common.NodeProp) to associate with this node.
    */
    props) {
        this.type = type;
        this.children = children;
        this.positions = positions;
        this.length = length;
        /**
        @internal
        */
        this.props = null;
        if (props && props.length) {
            this.props = Object.create(null);
            for (let [prop, value] of props)
                this.props[typeof prop == "number" ? prop : prop.id] = value;
        }
    }
    /**
    @internal
    */
    toString() {
        let mounted = MountedTree.get(this);
        if (mounted && !mounted.overlay)
            return mounted.tree.toString();
        let children = "";
        for (let ch of this.children) {
            let str = ch.toString();
            if (str) {
                if (children)
                    children += ",";
                children += str;
            }
        }
        return !this.type.name ? children :
            (/\W/.test(this.type.name) && !this.type.isError ? JSON.stringify(this.type.name) : this.type.name) +
                (children.length ? "(" + children + ")" : "");
    }
    /**
    Get a [tree cursor](#common.TreeCursor) positioned at the top of
    the tree. Mode can be used to [control](#common.IterMode) which
    nodes the cursor visits.
    */
    cursor(mode = 0) {
        return new TreeCursor(this.topNode, mode);
    }
    /**
    Get a [tree cursor](#common.TreeCursor) pointing into this tree
    at the given position and side (see
    [`moveTo`](#common.TreeCursor.moveTo).
    */
    cursorAt(pos, side = 0, mode = 0) {
        let scope = CachedNode.get(this) || this.topNode;
        let cursor = new TreeCursor(scope);
        cursor.moveTo(pos, side);
        CachedNode.set(this, cursor._tree);
        return cursor;
    }
    /**
    Get a [syntax node](#common.SyntaxNode) object for the top of the
    tree.
    */
    get topNode() {
        return new TreeNode(this, 0, 0, null);
    }
    /**
    Get the [syntax node](#common.SyntaxNode) at the given position.
    If `side` is -1, this will move into nodes that end at the
    position. If 1, it'll move into nodes that start at the
    position. With 0, it'll only enter nodes that cover the position
    from both sides.
    
    Note that this will not enter
    [overlays](#common.MountedTree.overlay), and you often want
    [`resolveInner`](#common.Tree.resolveInner) instead.
    */
    resolve(pos, side = 0) {
        let node = resolveNode(CachedNode.get(this) || this.topNode, pos, side, false);
        CachedNode.set(this, node);
        return node;
    }
    /**
    Like [`resolve`](#common.Tree.resolve), but will enter
    [overlaid](#common.MountedTree.overlay) nodes, producing a syntax node
    pointing into the innermost overlaid tree at the given position
    (with parent links going through all parent structure, including
    the host trees).
    */
    resolveInner(pos, side = 0) {
        let node = resolveNode(CachedInnerNode.get(this) || this.topNode, pos, side, true);
        CachedInnerNode.set(this, node);
        return node;
    }
    /**
    In some situations, it can be useful to iterate through all
    nodes around a position, including those in overlays that don't
    directly cover the position. This method gives you an iterator
    that will produce all nodes, from small to big, around the given
    position.
    */
    resolveStack(pos, side = 0) {
        return stackIterator(this, pos, side);
    }
    /**
    Iterate over the tree and its children, calling `enter` for any
    node that touches the `from`/`to` region (if given) before
    running over such a node's children, and `leave` (if given) when
    leaving the node. When `enter` returns `false`, that node will
    not have its children iterated over (or `leave` called).
    */
    iterate(spec) {
        let { enter, leave, from = 0, to = this.length } = spec;
        let mode = spec.mode || 0, anon = (mode & IterMode.IncludeAnonymous) > 0;
        for (let c = this.cursor(mode | IterMode.IncludeAnonymous);;) {
            let entered = false;
            if (c.from <= to && c.to >= from && (!anon && c.type.isAnonymous || enter(c) !== false)) {
                if (c.firstChild())
                    continue;
                entered = true;
            }
            for (;;) {
                if (entered && leave && (anon || !c.type.isAnonymous))
                    leave(c);
                if (c.nextSibling())
                    break;
                if (!c.parent())
                    return;
                entered = true;
            }
        }
    }
    /**
    Get the value of the given [node prop](#common.NodeProp) for this
    node. Works with both per-node and per-type props.
    */
    prop(prop) {
        return !prop.perNode ? this.type.prop(prop) : this.props ? this.props[prop.id] : undefined;
    }
    /**
    Returns the node's [per-node props](#common.NodeProp.perNode) in a
    format that can be passed to the [`Tree`](#common.Tree)
    constructor.
    */
    get propValues() {
        let result = [];
        if (this.props)
            for (let id in this.props)
                result.push([+id, this.props[id]]);
        return result;
    }
    /**
    Balance the direct children of this tree, producing a copy of
    which may have children grouped into subtrees with type
    [`NodeType.none`](#common.NodeType^none).
    */
    balance(config = {}) {
        return this.children.length <= 8 /* Balance.BranchFactor */ ? this :
            balanceRange(NodeType.none, this.children, this.positions, 0, this.children.length, 0, this.length, (children, positions, length) => new Tree(this.type, children, positions, length, this.propValues), config.makeTree || ((children, positions, length) => new Tree(NodeType.none, children, positions, length)));
    }
    /**
    Build a tree from a postfix-ordered buffer of node information,
    or a cursor over such a buffer.
    */
    static build(data) { return buildTree(data); }
}
/**
The empty tree
*/
Tree.empty = new Tree(NodeType.none, [], [], 0);
class FlatBufferCursor {
    constructor(buffer, index) {
        this.buffer = buffer;
        this.index = index;
    }
    get id() { return this.buffer[this.index - 4]; }
    get start() { return this.buffer[this.index - 3]; }
    get end() { return this.buffer[this.index - 2]; }
    get size() { return this.buffer[this.index - 1]; }
    get pos() { return this.index; }
    next() { this.index -= 4; }
    fork() { return new FlatBufferCursor(this.buffer, this.index); }
}
/**
Tree buffers contain (type, start, end, endIndex) quads for each
node. In such a buffer, nodes are stored in prefix order (parents
before children, with the endIndex of the parent indicating which
children belong to it).
*/
class TreeBuffer {
    /**
    Create a tree buffer.
    */
    constructor(
    /**
    The buffer's content.
    */
    buffer, 
    /**
    The total length of the group of nodes in the buffer.
    */
    length, 
    /**
    The node set used in this buffer.
    */
    set) {
        this.buffer = buffer;
        this.length = length;
        this.set = set;
    }
    /**
    @internal
    */
    get type() { return NodeType.none; }
    /**
    @internal
    */
    toString() {
        let result = [];
        for (let index = 0; index < this.buffer.length;) {
            result.push(this.childString(index));
            index = this.buffer[index + 3];
        }
        return result.join(",");
    }
    /**
    @internal
    */
    childString(index) {
        let id = this.buffer[index], endIndex = this.buffer[index + 3];
        let type = this.set.types[id], result = type.name;
        if (/\W/.test(result) && !type.isError)
            result = JSON.stringify(result);
        index += 4;
        if (endIndex == index)
            return result;
        let children = [];
        while (index < endIndex) {
            children.push(this.childString(index));
            index = this.buffer[index + 3];
        }
        return result + "(" + children.join(",") + ")";
    }
    /**
    @internal
    */
    findChild(startIndex, endIndex, dir, pos, side) {
        let { buffer } = this, pick = -1;
        for (let i = startIndex; i != endIndex; i = buffer[i + 3]) {
            if (checkSide(side, pos, buffer[i + 1], buffer[i + 2])) {
                pick = i;
                if (dir > 0)
                    break;
            }
        }
        return pick;
    }
    /**
    @internal
    */
    slice(startI, endI, from) {
        let b = this.buffer;
        let copy = new Uint16Array(endI - startI), len = 0;
        for (let i = startI, j = 0; i < endI;) {
            copy[j++] = b[i++];
            copy[j++] = b[i++] - from;
            let to = copy[j++] = b[i++] - from;
            copy[j++] = b[i++] - startI;
            len = Math.max(len, to);
        }
        return new TreeBuffer(copy, len, this.set);
    }
}
function checkSide(side, pos, from, to) {
    switch (side) {
        case -2 /* Side.Before */: return from < pos;
        case -1 /* Side.AtOrBefore */: return to >= pos && from < pos;
        case 0 /* Side.Around */: return from < pos && to > pos;
        case 1 /* Side.AtOrAfter */: return from <= pos && to > pos;
        case 2 /* Side.After */: return to > pos;
        case 4 /* Side.DontCare */: return true;
    }
}
function resolveNode(node, pos, side, overlays) {
    var _a;
    // Move up to a node that actually holds the position, if possible
    while (node.from == node.to ||
        (side < 1 ? node.from >= pos : node.from > pos) ||
        (side > -1 ? node.to <= pos : node.to < pos)) {
        let parent = !overlays && node instanceof TreeNode && node.index < 0 ? null : node.parent;
        if (!parent)
            return node;
        node = parent;
    }
    let mode = overlays ? 0 : IterMode.IgnoreOverlays;
    // Must go up out of overlays when those do not overlap with pos
    if (overlays)
        for (let scan = node, parent = scan.parent; parent; scan = parent, parent = scan.parent) {
            if (scan instanceof TreeNode && scan.index < 0 && ((_a = parent.enter(pos, side, mode)) === null || _a === void 0 ? void 0 : _a.from) != scan.from)
                node = parent;
        }
    for (;;) {
        let inner = node.enter(pos, side, mode);
        if (!inner)
            return node;
        node = inner;
    }
}
class BaseNode {
    cursor(mode = 0) { return new TreeCursor(this, mode); }
    getChild(type, before = null, after = null) {
        let r = getChildren(this, type, before, after);
        return r.length ? r[0] : null;
    }
    getChildren(type, before = null, after = null) {
        return getChildren(this, type, before, after);
    }
    resolve(pos, side = 0) {
        return resolveNode(this, pos, side, false);
    }
    resolveInner(pos, side = 0) {
        return resolveNode(this, pos, side, true);
    }
    matchContext(context) {
        return matchNodeContext(this, context);
    }
    enterUnfinishedNodesBefore(pos) {
        let scan = this.childBefore(pos), node = this;
        while (scan) {
            let last = scan.lastChild;
            if (!last || last.to != scan.to)
                break;
            if (last.type.isError && last.from == last.to) {
                node = scan;
                scan = last.prevSibling;
            }
            else {
                scan = last;
            }
        }
        return node;
    }
    get node() { return this; }
    get next() { return this.parent; }
}
class TreeNode extends BaseNode {
    constructor(_tree, from, 
    // Index in parent node, set to -1 if the node is not a direct child of _parent.node (overlay)
    index, _parent) {
        super();
        this._tree = _tree;
        this.from = from;
        this.index = index;
        this._parent = _parent;
    }
    get type() { return this._tree.type; }
    get name() { return this._tree.type.name; }
    get to() { return this.from + this._tree.length; }
    nextChild(i, dir, pos, side, mode = 0) {
        for (let parent = this;;) {
            for (let { children, positions } = parent._tree, e = dir > 0 ? children.length : -1; i != e; i += dir) {
                let next = children[i], start = positions[i] + parent.from;
                if (!checkSide(side, pos, start, start + next.length))
                    continue;
                if (next instanceof TreeBuffer) {
                    if (mode & IterMode.ExcludeBuffers)
                        continue;
                    let index = next.findChild(0, next.buffer.length, dir, pos - start, side);
                    if (index > -1)
                        return new BufferNode(new BufferContext(parent, next, i, start), null, index);
                }
                else if ((mode & IterMode.IncludeAnonymous) || (!next.type.isAnonymous || hasChild(next))) {
                    let mounted;
                    if (!(mode & IterMode.IgnoreMounts) && (mounted = MountedTree.get(next)) && !mounted.overlay)
                        return new TreeNode(mounted.tree, start, i, parent);
                    let inner = new TreeNode(next, start, i, parent);
                    return (mode & IterMode.IncludeAnonymous) || !inner.type.isAnonymous ? inner
                        : inner.nextChild(dir < 0 ? next.children.length - 1 : 0, dir, pos, side);
                }
            }
            if ((mode & IterMode.IncludeAnonymous) || !parent.type.isAnonymous)
                return null;
            if (parent.index >= 0)
                i = parent.index + dir;
            else
                i = dir < 0 ? -1 : parent._parent._tree.children.length;
            parent = parent._parent;
            if (!parent)
                return null;
        }
    }
    get firstChild() { return this.nextChild(0, 1, 0, 4 /* Side.DontCare */); }
    get lastChild() { return this.nextChild(this._tree.children.length - 1, -1, 0, 4 /* Side.DontCare */); }
    childAfter(pos) { return this.nextChild(0, 1, pos, 2 /* Side.After */); }
    childBefore(pos) { return this.nextChild(this._tree.children.length - 1, -1, pos, -2 /* Side.Before */); }
    enter(pos, side, mode = 0) {
        let mounted;
        if (!(mode & IterMode.IgnoreOverlays) && (mounted = MountedTree.get(this._tree)) && mounted.overlay) {
            let rPos = pos - this.from;
            for (let { from, to } of mounted.overlay) {
                if ((side > 0 ? from <= rPos : from < rPos) &&
                    (side < 0 ? to >= rPos : to > rPos))
                    return new TreeNode(mounted.tree, mounted.overlay[0].from + this.from, -1, this);
            }
        }
        return this.nextChild(0, 1, pos, side, mode);
    }
    nextSignificantParent() {
        let val = this;
        while (val.type.isAnonymous && val._parent)
            val = val._parent;
        return val;
    }
    get parent() {
        return this._parent ? this._parent.nextSignificantParent() : null;
    }
    get nextSibling() {
        return this._parent && this.index >= 0 ? this._parent.nextChild(this.index + 1, 1, 0, 4 /* Side.DontCare */) : null;
    }
    get prevSibling() {
        return this._parent && this.index >= 0 ? this._parent.nextChild(this.index - 1, -1, 0, 4 /* Side.DontCare */) : null;
    }
    get tree() { return this._tree; }
    toTree() { return this._tree; }
    /**
    @internal
    */
    toString() { return this._tree.toString(); }
}
function getChildren(node, type, before, after) {
    let cur = node.cursor(), result = [];
    if (!cur.firstChild())
        return result;
    if (before != null)
        for (let found = false; !found;) {
            found = cur.type.is(before);
            if (!cur.nextSibling())
                return result;
        }
    for (;;) {
        if (after != null && cur.type.is(after))
            return result;
        if (cur.type.is(type))
            result.push(cur.node);
        if (!cur.nextSibling())
            return after == null ? result : [];
    }
}
function matchNodeContext(node, context, i = context.length - 1) {
    for (let p = node.parent; i >= 0; p = p.parent) {
        if (!p)
            return false;
        if (!p.type.isAnonymous) {
            if (context[i] && context[i] != p.name)
                return false;
            i--;
        }
    }
    return true;
}
class BufferContext {
    constructor(parent, buffer, index, start) {
        this.parent = parent;
        this.buffer = buffer;
        this.index = index;
        this.start = start;
    }
}
class BufferNode extends BaseNode {
    get name() { return this.type.name; }
    get from() { return this.context.start + this.context.buffer.buffer[this.index + 1]; }
    get to() { return this.context.start + this.context.buffer.buffer[this.index + 2]; }
    constructor(context, _parent, index) {
        super();
        this.context = context;
        this._parent = _parent;
        this.index = index;
        this.type = context.buffer.set.types[context.buffer.buffer[index]];
    }
    child(dir, pos, side) {
        let { buffer } = this.context;
        let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], dir, pos - this.context.start, side);
        return index < 0 ? null : new BufferNode(this.context, this, index);
    }
    get firstChild() { return this.child(1, 0, 4 /* Side.DontCare */); }
    get lastChild() { return this.child(-1, 0, 4 /* Side.DontCare */); }
    childAfter(pos) { return this.child(1, pos, 2 /* Side.After */); }
    childBefore(pos) { return this.child(-1, pos, -2 /* Side.Before */); }
    enter(pos, side, mode = 0) {
        if (mode & IterMode.ExcludeBuffers)
            return null;
        let { buffer } = this.context;
        let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], side > 0 ? 1 : -1, pos - this.context.start, side);
        return index < 0 ? null : new BufferNode(this.context, this, index);
    }
    get parent() {
        return this._parent || this.context.parent.nextSignificantParent();
    }
    externalSibling(dir) {
        return this._parent ? null : this.context.parent.nextChild(this.context.index + dir, dir, 0, 4 /* Side.DontCare */);
    }
    get nextSibling() {
        let { buffer } = this.context;
        let after = buffer.buffer[this.index + 3];
        if (after < (this._parent ? buffer.buffer[this._parent.index + 3] : buffer.buffer.length))
            return new BufferNode(this.context, this._parent, after);
        return this.externalSibling(1);
    }
    get prevSibling() {
        let { buffer } = this.context;
        let parentStart = this._parent ? this._parent.index + 4 : 0;
        if (this.index == parentStart)
            return this.externalSibling(-1);
        return new BufferNode(this.context, this._parent, buffer.findChild(parentStart, this.index, -1, 0, 4 /* Side.DontCare */));
    }
    get tree() { return null; }
    toTree() {
        let children = [], positions = [];
        let { buffer } = this.context;
        let startI = this.index + 4, endI = buffer.buffer[this.index + 3];
        if (endI > startI) {
            let from = buffer.buffer[this.index + 1];
            children.push(buffer.slice(startI, endI, from));
            positions.push(0);
        }
        return new Tree(this.type, children, positions, this.to - this.from);
    }
    /**
    @internal
    */
    toString() { return this.context.buffer.childString(this.index); }
}
function iterStack(heads) {
    if (!heads.length)
        return null;
    let pick = 0, picked = heads[0];
    for (let i = 1; i < heads.length; i++) {
        let node = heads[i];
        if (node.from > picked.from || node.to < picked.to) {
            picked = node;
            pick = i;
        }
    }
    let next = picked instanceof TreeNode && picked.index < 0 ? null : picked.parent;
    let newHeads = heads.slice();
    if (next)
        newHeads[pick] = next;
    else
        newHeads.splice(pick, 1);
    return new StackIterator(newHeads, picked);
}
class StackIterator {
    constructor(heads, node) {
        this.heads = heads;
        this.node = node;
    }
    get next() { return iterStack(this.heads); }
}
function stackIterator(tree, pos, side) {
    let inner = tree.resolveInner(pos, side), layers = null;
    for (let scan = inner instanceof TreeNode ? inner : inner.context.parent; scan; scan = scan.parent) {
        if (scan.index < 0) { // This is an overlay root
            let parent = scan.parent;
            (layers || (layers = [inner])).push(parent.resolve(pos, side));
            scan = parent;
        }
        else {
            let mount = MountedTree.get(scan.tree);
            // Relevant overlay branching off
            if (mount && mount.overlay && mount.overlay[0].from <= pos && mount.overlay[mount.overlay.length - 1].to >= pos) {
                let root = new TreeNode(mount.tree, mount.overlay[0].from + scan.from, -1, scan);
                (layers || (layers = [inner])).push(resolveNode(root, pos, side, false));
            }
        }
    }
    return layers ? iterStack(layers) : inner;
}
/**
A tree cursor object focuses on a given node in a syntax tree, and
allows you to move to adjacent nodes.
*/
class TreeCursor {
    /**
    Shorthand for `.type.name`.
    */
    get name() { return this.type.name; }
    /**
    @internal
    */
    constructor(node, 
    /**
    @internal
    */
    mode = 0) {
        this.mode = mode;
        /**
        @internal
        */
        this.buffer = null;
        this.stack = [];
        /**
        @internal
        */
        this.index = 0;
        this.bufferNode = null;
        if (node instanceof TreeNode) {
            this.yieldNode(node);
        }
        else {
            this._tree = node.context.parent;
            this.buffer = node.context;
            for (let n = node._parent; n; n = n._parent)
                this.stack.unshift(n.index);
            this.bufferNode = node;
            this.yieldBuf(node.index);
        }
    }
    yieldNode(node) {
        if (!node)
            return false;
        this._tree = node;
        this.type = node.type;
        this.from = node.from;
        this.to = node.to;
        return true;
    }
    yieldBuf(index, type) {
        this.index = index;
        let { start, buffer } = this.buffer;
        this.type = type || buffer.set.types[buffer.buffer[index]];
        this.from = start + buffer.buffer[index + 1];
        this.to = start + buffer.buffer[index + 2];
        return true;
    }
    /**
    @internal
    */
    yield(node) {
        if (!node)
            return false;
        if (node instanceof TreeNode) {
            this.buffer = null;
            return this.yieldNode(node);
        }
        this.buffer = node.context;
        return this.yieldBuf(node.index, node.type);
    }
    /**
    @internal
    */
    toString() {
        return this.buffer ? this.buffer.buffer.childString(this.index) : this._tree.toString();
    }
    /**
    @internal
    */
    enterChild(dir, pos, side) {
        if (!this.buffer)
            return this.yield(this._tree.nextChild(dir < 0 ? this._tree._tree.children.length - 1 : 0, dir, pos, side, this.mode));
        let { buffer } = this.buffer;
        let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], dir, pos - this.buffer.start, side);
        if (index < 0)
            return false;
        this.stack.push(this.index);
        return this.yieldBuf(index);
    }
    /**
    Move the cursor to this node's first child. When this returns
    false, the node has no child, and the cursor has not been moved.
    */
    firstChild() { return this.enterChild(1, 0, 4 /* Side.DontCare */); }
    /**
    Move the cursor to this node's last child.
    */
    lastChild() { return this.enterChild(-1, 0, 4 /* Side.DontCare */); }
    /**
    Move the cursor to the first child that ends after `pos`.
    */
    childAfter(pos) { return this.enterChild(1, pos, 2 /* Side.After */); }
    /**
    Move to the last child that starts before `pos`.
    */
    childBefore(pos) { return this.enterChild(-1, pos, -2 /* Side.Before */); }
    /**
    Move the cursor to the child around `pos`. If side is -1 the
    child may end at that position, when 1 it may start there. This
    will also enter [overlaid](#common.MountedTree.overlay)
    [mounted](#common.NodeProp^mounted) trees unless `overlays` is
    set to false.
    */
    enter(pos, side, mode = this.mode) {
        if (!this.buffer)
            return this.yield(this._tree.enter(pos, side, mode));
        return mode & IterMode.ExcludeBuffers ? false : this.enterChild(1, pos, side);
    }
    /**
    Move to the node's parent node, if this isn't the top node.
    */
    parent() {
        if (!this.buffer)
            return this.yieldNode((this.mode & IterMode.IncludeAnonymous) ? this._tree._parent : this._tree.parent);
        if (this.stack.length)
            return this.yieldBuf(this.stack.pop());
        let parent = (this.mode & IterMode.IncludeAnonymous) ? this.buffer.parent : this.buffer.parent.nextSignificantParent();
        this.buffer = null;
        return this.yieldNode(parent);
    }
    /**
    @internal
    */
    sibling(dir) {
        if (!this.buffer)
            return !this._tree._parent ? false
                : this.yield(this._tree.index < 0 ? null
                    : this._tree._parent.nextChild(this._tree.index + dir, dir, 0, 4 /* Side.DontCare */, this.mode));
        let { buffer } = this.buffer, d = this.stack.length - 1;
        if (dir < 0) {
            let parentStart = d < 0 ? 0 : this.stack[d] + 4;
            if (this.index != parentStart)
                return this.yieldBuf(buffer.findChild(parentStart, this.index, -1, 0, 4 /* Side.DontCare */));
        }
        else {
            let after = buffer.buffer[this.index + 3];
            if (after < (d < 0 ? buffer.buffer.length : buffer.buffer[this.stack[d] + 3]))
                return this.yieldBuf(after);
        }
        return d < 0 ? this.yield(this.buffer.parent.nextChild(this.buffer.index + dir, dir, 0, 4 /* Side.DontCare */, this.mode)) : false;
    }
    /**
    Move to this node's next sibling, if any.
    */
    nextSibling() { return this.sibling(1); }
    /**
    Move to this node's previous sibling, if any.
    */
    prevSibling() { return this.sibling(-1); }
    atLastNode(dir) {
        let index, parent, { buffer } = this;
        if (buffer) {
            if (dir > 0) {
                if (this.index < buffer.buffer.buffer.length)
                    return false;
            }
            else {
                for (let i = 0; i < this.index; i++)
                    if (buffer.buffer.buffer[i + 3] < this.index)
                        return false;
            }
            ({ index, parent } = buffer);
        }
        else {
            ({ index, _parent: parent } = this._tree);
        }
        for (; parent; { index, _parent: parent } = parent) {
            if (index > -1)
                for (let i = index + dir, e = dir < 0 ? -1 : parent._tree.children.length; i != e; i += dir) {
                    let child = parent._tree.children[i];
                    if ((this.mode & IterMode.IncludeAnonymous) ||
                        child instanceof TreeBuffer ||
                        !child.type.isAnonymous ||
                        hasChild(child))
                        return false;
                }
        }
        return true;
    }
    move(dir, enter) {
        if (enter && this.enterChild(dir, 0, 4 /* Side.DontCare */))
            return true;
        for (;;) {
            if (this.sibling(dir))
                return true;
            if (this.atLastNode(dir) || !this.parent())
                return false;
        }
    }
    /**
    Move to the next node in a
    [pre-order](https://en.wikipedia.org/wiki/Tree_traversal#Pre-order,_NLR)
    traversal, going from a node to its first child or, if the
    current node is empty or `enter` is false, its next sibling or
    the next sibling of the first parent node that has one.
    */
    next(enter = true) { return this.move(1, enter); }
    /**
    Move to the next node in a last-to-first pre-order traveral. A
    node is followed by its last child or, if it has none, its
    previous sibling or the previous sibling of the first parent
    node that has one.
    */
    prev(enter = true) { return this.move(-1, enter); }
    /**
    Move the cursor to the innermost node that covers `pos`. If
    `side` is -1, it will enter nodes that end at `pos`. If it is 1,
    it will enter nodes that start at `pos`.
    */
    moveTo(pos, side = 0) {
        // Move up to a node that actually holds the position, if possible
        while (this.from == this.to ||
            (side < 1 ? this.from >= pos : this.from > pos) ||
            (side > -1 ? this.to <= pos : this.to < pos))
            if (!this.parent())
                break;
        // Then scan down into child nodes as far as possible
        while (this.enterChild(1, pos, side)) { }
        return this;
    }
    /**
    Get a [syntax node](#common.SyntaxNode) at the cursor's current
    position.
    */
    get node() {
        if (!this.buffer)
            return this._tree;
        let cache = this.bufferNode, result = null, depth = 0;
        if (cache && cache.context == this.buffer) {
            scan: for (let index = this.index, d = this.stack.length; d >= 0;) {
                for (let c = cache; c; c = c._parent)
                    if (c.index == index) {
                        if (index == this.index)
                            return c;
                        result = c;
                        depth = d + 1;
                        break scan;
                    }
                index = this.stack[--d];
            }
        }
        for (let i = depth; i < this.stack.length; i++)
            result = new BufferNode(this.buffer, result, this.stack[i]);
        return this.bufferNode = new BufferNode(this.buffer, result, this.index);
    }
    /**
    Get the [tree](#common.Tree) that represents the current node, if
    any. Will return null when the node is in a [tree
    buffer](#common.TreeBuffer).
    */
    get tree() {
        return this.buffer ? null : this._tree._tree;
    }
    /**
    Iterate over the current node and all its descendants, calling
    `enter` when entering a node and `leave`, if given, when leaving
    one. When `enter` returns `false`, any children of that node are
    skipped, and `leave` isn't called for it.
    */
    iterate(enter, leave) {
        for (let depth = 0;;) {
            let mustLeave = false;
            if (this.type.isAnonymous || enter(this) !== false) {
                if (this.firstChild()) {
                    depth++;
                    continue;
                }
                if (!this.type.isAnonymous)
                    mustLeave = true;
            }
            for (;;) {
                if (mustLeave && leave)
                    leave(this);
                mustLeave = this.type.isAnonymous;
                if (this.nextSibling())
                    break;
                if (!depth)
                    return;
                this.parent();
                depth--;
                mustLeave = true;
            }
        }
    }
    /**
    Test whether the current node matches a given context—a sequence
    of direct parent node names. Empty strings in the context array
    are treated as wildcards.
    */
    matchContext(context) {
        if (!this.buffer)
            return matchNodeContext(this.node, context);
        let { buffer } = this.buffer, { types } = buffer.set;
        for (let i = context.length - 1, d = this.stack.length - 1; i >= 0; d--) {
            if (d < 0)
                return matchNodeContext(this.node, context, i);
            let type = types[buffer.buffer[this.stack[d]]];
            if (!type.isAnonymous) {
                if (context[i] && context[i] != type.name)
                    return false;
                i--;
            }
        }
        return true;
    }
}
function hasChild(tree) {
    return tree.children.some(ch => ch instanceof TreeBuffer || !ch.type.isAnonymous || hasChild(ch));
}
function buildTree(data) {
    var _a;
    let { buffer, nodeSet, maxBufferLength = DefaultBufferLength, reused = [], minRepeatType = nodeSet.types.length } = data;
    let cursor = Array.isArray(buffer) ? new FlatBufferCursor(buffer, buffer.length) : buffer;
    let types = nodeSet.types;
    let contextHash = 0, lookAhead = 0;
    function takeNode(parentStart, minPos, children, positions, inRepeat, depth) {
        let { id, start, end, size } = cursor;
        let lookAheadAtStart = lookAhead;
        while (size < 0) {
            cursor.next();
            if (size == -1 /* SpecialRecord.Reuse */) {
                let node = reused[id];
                children.push(node);
                positions.push(start - parentStart);
                return;
            }
            else if (size == -3 /* SpecialRecord.ContextChange */) { // Context change
                contextHash = id;
                return;
            }
            else if (size == -4 /* SpecialRecord.LookAhead */) {
                lookAhead = id;
                return;
            }
            else {
                throw new RangeError(`Unrecognized record size: ${size}`);
            }
        }
        let type = types[id], node, buffer;
        let startPos = start - parentStart;
        if (end - start <= maxBufferLength && (buffer = findBufferSize(cursor.pos - minPos, inRepeat))) {
            // Small enough for a buffer, and no reused nodes inside
            let data = new Uint16Array(buffer.size - buffer.skip);
            let endPos = cursor.pos - buffer.size, index = data.length;
            while (cursor.pos > endPos)
                index = copyToBuffer(buffer.start, data, index);
            node = new TreeBuffer(data, end - buffer.start, nodeSet);
            startPos = buffer.start - parentStart;
        }
        else { // Make it a node
            let endPos = cursor.pos - size;
            cursor.next();
            let localChildren = [], localPositions = [];
            let localInRepeat = id >= minRepeatType ? id : -1;
            let lastGroup = 0, lastEnd = end;
            while (cursor.pos > endPos) {
                if (localInRepeat >= 0 && cursor.id == localInRepeat && cursor.size >= 0) {
                    if (cursor.end <= lastEnd - maxBufferLength) {
                        makeRepeatLeaf(localChildren, localPositions, start, lastGroup, cursor.end, lastEnd, localInRepeat, lookAheadAtStart);
                        lastGroup = localChildren.length;
                        lastEnd = cursor.end;
                    }
                    cursor.next();
                }
                else if (depth > 2500 /* CutOff.Depth */) {
                    takeFlatNode(start, endPos, localChildren, localPositions);
                }
                else {
                    takeNode(start, endPos, localChildren, localPositions, localInRepeat, depth + 1);
                }
            }
            if (localInRepeat >= 0 && lastGroup > 0 && lastGroup < localChildren.length)
                makeRepeatLeaf(localChildren, localPositions, start, lastGroup, start, lastEnd, localInRepeat, lookAheadAtStart);
            localChildren.reverse();
            localPositions.reverse();
            if (localInRepeat > -1 && lastGroup > 0) {
                let make = makeBalanced(type);
                node = balanceRange(type, localChildren, localPositions, 0, localChildren.length, 0, end - start, make, make);
            }
            else {
                node = makeTree(type, localChildren, localPositions, end - start, lookAheadAtStart - end);
            }
        }
        children.push(node);
        positions.push(startPos);
    }
    function takeFlatNode(parentStart, minPos, children, positions) {
        let nodes = []; // Temporary, inverted array of leaf nodes found, with absolute positions
        let nodeCount = 0, stopAt = -1;
        while (cursor.pos > minPos) {
            let { id, start, end, size } = cursor;
            if (size > 4) { // Not a leaf
                cursor.next();
            }
            else if (stopAt > -1 && start < stopAt) {
                break;
            }
            else {
                if (stopAt < 0)
                    stopAt = end - maxBufferLength;
                nodes.push(id, start, end);
                nodeCount++;
                cursor.next();
            }
        }
        if (nodeCount) {
            let buffer = new Uint16Array(nodeCount * 4);
            let start = nodes[nodes.length - 2];
            for (let i = nodes.length - 3, j = 0; i >= 0; i -= 3) {
                buffer[j++] = nodes[i];
                buffer[j++] = nodes[i + 1] - start;
                buffer[j++] = nodes[i + 2] - start;
                buffer[j++] = j;
            }
            children.push(new TreeBuffer(buffer, nodes[2] - start, nodeSet));
            positions.push(start - parentStart);
        }
    }
    function makeBalanced(type) {
        return (children, positions, length) => {
            let lookAhead = 0, lastI = children.length - 1, last, lookAheadProp;
            if (lastI >= 0 && (last = children[lastI]) instanceof Tree) {
                if (!lastI && last.type == type && last.length == length)
                    return last;
                if (lookAheadProp = last.prop(NodeProp.lookAhead))
                    lookAhead = positions[lastI] + last.length + lookAheadProp;
            }
            return makeTree(type, children, positions, length, lookAhead);
        };
    }
    function makeRepeatLeaf(children, positions, base, i, from, to, type, lookAhead) {
        let localChildren = [], localPositions = [];
        while (children.length > i) {
            localChildren.push(children.pop());
            localPositions.push(positions.pop() + base - from);
        }
        children.push(makeTree(nodeSet.types[type], localChildren, localPositions, to - from, lookAhead - to));
        positions.push(from - base);
    }
    function makeTree(type, children, positions, length, lookAhead = 0, props) {
        if (contextHash) {
            let pair = [NodeProp.contextHash, contextHash];
            props = props ? [pair].concat(props) : [pair];
        }
        if (lookAhead > 25) {
            let pair = [NodeProp.lookAhead, lookAhead];
            props = props ? [pair].concat(props) : [pair];
        }
        return new Tree(type, children, positions, length, props);
    }
    function findBufferSize(maxSize, inRepeat) {
        // Scan through the buffer to find previous siblings that fit
        // together in a TreeBuffer, and don't contain any reused nodes
        // (which can't be stored in a buffer).
        // If `inRepeat` is > -1, ignore node boundaries of that type for
        // nesting, but make sure the end falls either at the start
        // (`maxSize`) or before such a node.
        let fork = cursor.fork();
        let size = 0, start = 0, skip = 0, minStart = fork.end - maxBufferLength;
        let result = { size: 0, start: 0, skip: 0 };
        scan: for (let minPos = fork.pos - maxSize; fork.pos > minPos;) {
            let nodeSize = fork.size;
            // Pretend nested repeat nodes of the same type don't exist
            if (fork.id == inRepeat && nodeSize >= 0) {
                // Except that we store the current state as a valid return
                // value.
                result.size = size;
                result.start = start;
                result.skip = skip;
                skip += 4;
                size += 4;
                fork.next();
                continue;
            }
            let startPos = fork.pos - nodeSize;
            if (nodeSize < 0 || startPos < minPos || fork.start < minStart)
                break;
            let localSkipped = fork.id >= minRepeatType ? 4 : 0;
            let nodeStart = fork.start;
            fork.next();
            while (fork.pos > startPos) {
                if (fork.size < 0) {
                    if (fork.size == -3 /* SpecialRecord.ContextChange */)
                        localSkipped += 4;
                    else
                        break scan;
                }
                else if (fork.id >= minRepeatType) {
                    localSkipped += 4;
                }
                fork.next();
            }
            start = nodeStart;
            size += nodeSize;
            skip += localSkipped;
        }
        if (inRepeat < 0 || size == maxSize) {
            result.size = size;
            result.start = start;
            result.skip = skip;
        }
        return result.size > 4 ? result : undefined;
    }
    function copyToBuffer(bufferStart, buffer, index) {
        let { id, start, end, size } = cursor;
        cursor.next();
        if (size >= 0 && id < minRepeatType) {
            let startIndex = index;
            if (size > 4) {
                let endPos = cursor.pos - (size - 4);
                while (cursor.pos > endPos)
                    index = copyToBuffer(bufferStart, buffer, index);
            }
            buffer[--index] = startIndex;
            buffer[--index] = end - bufferStart;
            buffer[--index] = start - bufferStart;
            buffer[--index] = id;
        }
        else if (size == -3 /* SpecialRecord.ContextChange */) {
            contextHash = id;
        }
        else if (size == -4 /* SpecialRecord.LookAhead */) {
            lookAhead = id;
        }
        return index;
    }
    let children = [], positions = [];
    while (cursor.pos > 0)
        takeNode(data.start || 0, data.bufferStart || 0, children, positions, -1, 0);
    let length = (_a = data.length) !== null && _a !== void 0 ? _a : (children.length ? positions[0] + children[0].length : 0);
    return new Tree(types[data.topID], children.reverse(), positions.reverse(), length);
}
const nodeSizeCache = new WeakMap;
function nodeSize(balanceType, node) {
    if (!balanceType.isAnonymous || node instanceof TreeBuffer || node.type != balanceType)
        return 1;
    let size = nodeSizeCache.get(node);
    if (size == null) {
        size = 1;
        for (let child of node.children) {
            if (child.type != balanceType || !(child instanceof Tree)) {
                size = 1;
                break;
            }
            size += nodeSize(balanceType, child);
        }
        nodeSizeCache.set(node, size);
    }
    return size;
}
function balanceRange(
// The type the balanced tree's inner nodes.
balanceType, 
// The direct children and their positions
children, positions, 
// The index range in children/positions to use
from, to, 
// The start position of the nodes, relative to their parent.
start, 
// Length of the outer node
length, 
// Function to build the top node of the balanced tree
mkTop, 
// Function to build internal nodes for the balanced tree
mkTree) {
    let total = 0;
    for (let i = from; i < to; i++)
        total += nodeSize(balanceType, children[i]);
    let maxChild = Math.ceil((total * 1.5) / 8 /* Balance.BranchFactor */);
    let localChildren = [], localPositions = [];
    function divide(children, positions, from, to, offset) {
        for (let i = from; i < to;) {
            let groupFrom = i, groupStart = positions[i], groupSize = nodeSize(balanceType, children[i]);
            i++;
            for (; i < to; i++) {
                let nextSize = nodeSize(balanceType, children[i]);
                if (groupSize + nextSize >= maxChild)
                    break;
                groupSize += nextSize;
            }
            if (i == groupFrom + 1) {
                if (groupSize > maxChild) {
                    let only = children[groupFrom]; // Only trees can have a size > 1
                    divide(only.children, only.positions, 0, only.children.length, positions[groupFrom] + offset);
                    continue;
                }
                localChildren.push(children[groupFrom]);
            }
            else {
                let length = positions[i - 1] + children[i - 1].length - groupStart;
                localChildren.push(balanceRange(balanceType, children, positions, groupFrom, i, groupStart, length, null, mkTree));
            }
            localPositions.push(groupStart + offset - start);
        }
    }
    divide(children, positions, from, to, 0);
    return (mkTop || mkTree)(localChildren, localPositions, length);
}
/**
Provides a way to associate values with pieces of trees. As long
as that part of the tree is reused, the associated values can be
retrieved from an updated tree.
*/
class NodeWeakMap {
    constructor() {
        this.map = new WeakMap();
    }
    setBuffer(buffer, index, value) {
        let inner = this.map.get(buffer);
        if (!inner)
            this.map.set(buffer, inner = new Map);
        inner.set(index, value);
    }
    getBuffer(buffer, index) {
        let inner = this.map.get(buffer);
        return inner && inner.get(index);
    }
    /**
    Set the value for this syntax node.
    */
    set(node, value) {
        if (node instanceof BufferNode)
            this.setBuffer(node.context.buffer, node.index, value);
        else if (node instanceof TreeNode)
            this.map.set(node.tree, value);
    }
    /**
    Retrieve value for this syntax node, if it exists in the map.
    */
    get(node) {
        return node instanceof BufferNode ? this.getBuffer(node.context.buffer, node.index)
            : node instanceof TreeNode ? this.map.get(node.tree) : undefined;
    }
    /**
    Set the value for the node that a cursor currently points to.
    */
    cursorSet(cursor, value) {
        if (cursor.buffer)
            this.setBuffer(cursor.buffer.buffer, cursor.index, value);
        else
            this.map.set(cursor.tree, value);
    }
    /**
    Retrieve the value for the node that a cursor currently points
    to.
    */
    cursorGet(cursor) {
        return cursor.buffer ? this.getBuffer(cursor.buffer.buffer, cursor.index) : this.map.get(cursor.tree);
    }
}

/**
Tree fragments are used during [incremental
parsing](#common.Parser.startParse) to track parts of old trees
that can be reused in a new parse. An array of fragments is used
to track regions of an old tree whose nodes might be reused in new
parses. Use the static
[`applyChanges`](#common.TreeFragment^applyChanges) method to
update fragments for document changes.
*/
class TreeFragment {
    /**
    Construct a tree fragment. You'll usually want to use
    [`addTree`](#common.TreeFragment^addTree) and
    [`applyChanges`](#common.TreeFragment^applyChanges) instead of
    calling this directly.
    */
    constructor(
    /**
    The start of the unchanged range pointed to by this fragment.
    This refers to an offset in the _updated_ document (as opposed
    to the original tree).
    */
    from, 
    /**
    The end of the unchanged range.
    */
    to, 
    /**
    The tree that this fragment is based on.
    */
    tree, 
    /**
    The offset between the fragment's tree and the document that
    this fragment can be used against. Add this when going from
    document to tree positions, subtract it to go from tree to
    document positions.
    */
    offset, openStart = false, openEnd = false) {
        this.from = from;
        this.to = to;
        this.tree = tree;
        this.offset = offset;
        this.open = (openStart ? 1 /* Open.Start */ : 0) | (openEnd ? 2 /* Open.End */ : 0);
    }
    /**
    Whether the start of the fragment represents the start of a
    parse, or the end of a change. (In the second case, it may not
    be safe to reuse some nodes at the start, depending on the
    parsing algorithm.)
    */
    get openStart() { return (this.open & 1 /* Open.Start */) > 0; }
    /**
    Whether the end of the fragment represents the end of a
    full-document parse, or the start of a change.
    */
    get openEnd() { return (this.open & 2 /* Open.End */) > 0; }
    /**
    Create a set of fragments from a freshly parsed tree, or update
    an existing set of fragments by replacing the ones that overlap
    with a tree with content from the new tree. When `partial` is
    true, the parse is treated as incomplete, and the resulting
    fragment has [`openEnd`](#common.TreeFragment.openEnd) set to
    true.
    */
    static addTree(tree, fragments = [], partial = false) {
        let result = [new TreeFragment(0, tree.length, tree, 0, false, partial)];
        for (let f of fragments)
            if (f.to > tree.length)
                result.push(f);
        return result;
    }
    /**
    Apply a set of edits to an array of fragments, removing or
    splitting fragments as necessary to remove edited ranges, and
    adjusting offsets for fragments that moved.
    */
    static applyChanges(fragments, changes, minGap = 128) {
        if (!changes.length)
            return fragments;
        let result = [];
        let fI = 1, nextF = fragments.length ? fragments[0] : null;
        for (let cI = 0, pos = 0, off = 0;; cI++) {
            let nextC = cI < changes.length ? changes[cI] : null;
            let nextPos = nextC ? nextC.fromA : 1e9;
            if (nextPos - pos >= minGap)
                while (nextF && nextF.from < nextPos) {
                    let cut = nextF;
                    if (pos >= cut.from || nextPos <= cut.to || off) {
                        let fFrom = Math.max(cut.from, pos) - off, fTo = Math.min(cut.to, nextPos) - off;
                        cut = fFrom >= fTo ? null : new TreeFragment(fFrom, fTo, cut.tree, cut.offset + off, cI > 0, !!nextC);
                    }
                    if (cut)
                        result.push(cut);
                    if (nextF.to > nextPos)
                        break;
                    nextF = fI < fragments.length ? fragments[fI++] : null;
                }
            if (!nextC)
                break;
            pos = nextC.toA;
            off = nextC.toA - nextC.toB;
        }
        return result;
    }
}
/**
A superclass that parsers should extend.
*/
class Parser {
    /**
    Start a parse, returning a [partial parse](#common.PartialParse)
    object. [`fragments`](#common.TreeFragment) can be passed in to
    make the parse incremental.
    
    By default, the entire input is parsed. You can pass `ranges`,
    which should be a sorted array of non-empty, non-overlapping
    ranges, to parse only those ranges. The tree returned in that
    case will start at `ranges[0].from`.
    */
    startParse(input, fragments, ranges) {
        if (typeof input == "string")
            input = new StringInput(input);
        ranges = !ranges ? [new Range(0, input.length)] : ranges.length ? ranges.map(r => new Range(r.from, r.to)) : [new Range(0, 0)];
        return this.createParse(input, fragments || [], ranges);
    }
    /**
    Run a full parse, returning the resulting tree.
    */
    parse(input, fragments, ranges) {
        let parse = this.startParse(input, fragments, ranges);
        for (;;) {
            let done = parse.advance();
            if (done)
                return done;
        }
    }
}
class StringInput {
    constructor(string) {
        this.string = string;
    }
    get length() { return this.string.length; }
    chunk(from) { return this.string.slice(from); }
    get lineChunks() { return false; }
    read(from, to) { return this.string.slice(from, to); }
}
new NodeProp({ perNode: true });

let nextTagID = 0;
/**
Highlighting tags are markers that denote a highlighting category.
They are [associated](#highlight.styleTags) with parts of a syntax
tree by a language mode, and then mapped to an actual CSS style by
a [highlighter](#highlight.Highlighter).

Because syntax tree node types and highlight styles have to be
able to talk the same language, CodeMirror uses a mostly _closed_
[vocabulary](#highlight.tags) of syntax tags (as opposed to
traditional open string-based systems, which make it hard for
highlighting themes to cover all the tokens produced by the
various languages).

It _is_ possible to [define](#highlight.Tag^define) your own
highlighting tags for system-internal use (where you control both
the language package and the highlighter), but such tags will not
be picked up by regular highlighters (though you can derive them
from standard tags to allow highlighters to fall back to those).
*/
class Tag {
    /**
    @internal
    */
    constructor(
    /**
    The set of this tag and all its parent tags, starting with
    this one itself and sorted in order of decreasing specificity.
    */
    set, 
    /**
    The base unmodified tag that this one is based on, if it's
    modified @internal
    */
    base, 
    /**
    The modifiers applied to this.base @internal
    */
    modified) {
        this.set = set;
        this.base = base;
        this.modified = modified;
        /**
        @internal
        */
        this.id = nextTagID++;
    }
    /**
    Define a new tag. If `parent` is given, the tag is treated as a
    sub-tag of that parent, and
    [highlighters](#highlight.tagHighlighter) that don't mention
    this tag will try to fall back to the parent tag (or grandparent
    tag, etc).
    */
    static define(parent) {
        if (parent === null || parent === void 0 ? void 0 : parent.base)
            throw new Error("Can not derive from a modified tag");
        let tag = new Tag([], null, []);
        tag.set.push(tag);
        if (parent)
            for (let t of parent.set)
                tag.set.push(t);
        return tag;
    }
    /**
    Define a tag _modifier_, which is a function that, given a tag,
    will return a tag that is a subtag of the original. Applying the
    same modifier to a twice tag will return the same value (`m1(t1)
    == m1(t1)`) and applying multiple modifiers will, regardless or
    order, produce the same tag (`m1(m2(t1)) == m2(m1(t1))`).
    
    When multiple modifiers are applied to a given base tag, each
    smaller set of modifiers is registered as a parent, so that for
    example `m1(m2(m3(t1)))` is a subtype of `m1(m2(t1))`,
    `m1(m3(t1)`, and so on.
    */
    static defineModifier() {
        let mod = new Modifier;
        return (tag) => {
            if (tag.modified.indexOf(mod) > -1)
                return tag;
            return Modifier.get(tag.base || tag, tag.modified.concat(mod).sort((a, b) => a.id - b.id));
        };
    }
}
let nextModifierID = 0;
class Modifier {
    constructor() {
        this.instances = [];
        this.id = nextModifierID++;
    }
    static get(base, mods) {
        if (!mods.length)
            return base;
        let exists = mods[0].instances.find(t => t.base == base && sameArray(mods, t.modified));
        if (exists)
            return exists;
        let set = [], tag = new Tag(set, base, mods);
        for (let m of mods)
            m.instances.push(tag);
        let configs = powerSet(mods);
        for (let parent of base.set)
            if (!parent.modified.length)
                for (let config of configs)
                    set.push(Modifier.get(parent, config));
        return tag;
    }
}
function sameArray(a, b) {
    return a.length == b.length && a.every((x, i) => x == b[i]);
}
function powerSet(array) {
    let sets = [[]];
    for (let i = 0; i < array.length; i++) {
        for (let j = 0, e = sets.length; j < e; j++) {
            sets.push(sets[j].concat(array[i]));
        }
    }
    return sets.sort((a, b) => b.length - a.length);
}
/**
This function is used to add a set of tags to a language syntax
via [`NodeSet.extend`](#common.NodeSet.extend) or
[`LRParser.configure`](#lr.LRParser.configure).

The argument object maps node selectors to [highlighting
tags](#highlight.Tag) or arrays of tags.

Node selectors may hold one or more (space-separated) node paths.
Such a path can be a [node name](#common.NodeType.name), or
multiple node names (or `*` wildcards) separated by slash
characters, as in `"Block/Declaration/VariableName"`. Such a path
matches the final node but only if its direct parent nodes are the
other nodes mentioned. A `*` in such a path matches any parent,
but only a single level—wildcards that match multiple parents
aren't supported, both for efficiency reasons and because Lezer
trees make it rather hard to reason about what they would match.)

A path can be ended with `/...` to indicate that the tag assigned
to the node should also apply to all child nodes, even if they
match their own style (by default, only the innermost style is
used).

When a path ends in `!`, as in `Attribute!`, no further matching
happens for the node's child nodes, and the entire node gets the
given style.

In this notation, node names that contain `/`, `!`, `*`, or `...`
must be quoted as JSON strings.

For example:

```javascript
parser.withProps(
  styleTags({
    // Style Number and BigNumber nodes
    "Number BigNumber": tags.number,
    // Style Escape nodes whose parent is String
    "String/Escape": tags.escape,
    // Style anything inside Attributes nodes
    "Attributes!": tags.meta,
    // Add a style to all content inside Italic nodes
    "Italic/...": tags.emphasis,
    // Style InvalidString nodes as both `string` and `invalid`
    "InvalidString": [tags.string, tags.invalid],
    // Style the node named "/" as punctuation
    '"/"': tags.punctuation
  })
)
```
*/
function styleTags(spec) {
    let byName = Object.create(null);
    for (let prop in spec) {
        let tags = spec[prop];
        if (!Array.isArray(tags))
            tags = [tags];
        for (let part of prop.split(" "))
            if (part) {
                let pieces = [], mode = 2 /* Mode.Normal */, rest = part;
                for (let pos = 0;;) {
                    if (rest == "..." && pos > 0 && pos + 3 == part.length) {
                        mode = 1 /* Mode.Inherit */;
                        break;
                    }
                    let m = /^"(?:[^"\\]|\\.)*?"|[^\/!]+/.exec(rest);
                    if (!m)
                        throw new RangeError("Invalid path: " + part);
                    pieces.push(m[0] == "*" ? "" : m[0][0] == '"' ? JSON.parse(m[0]) : m[0]);
                    pos += m[0].length;
                    if (pos == part.length)
                        break;
                    let next = part[pos++];
                    if (pos == part.length && next == "!") {
                        mode = 0 /* Mode.Opaque */;
                        break;
                    }
                    if (next != "/")
                        throw new RangeError("Invalid path: " + part);
                    rest = part.slice(pos);
                }
                let last = pieces.length - 1, inner = pieces[last];
                if (!inner)
                    throw new RangeError("Invalid path: " + part);
                let rule = new Rule(tags, mode, last > 0 ? pieces.slice(0, last) : null);
                byName[inner] = rule.sort(byName[inner]);
            }
    }
    return ruleNodeProp.add(byName);
}
const ruleNodeProp = new NodeProp();
class Rule {
    constructor(tags, mode, context, next) {
        this.tags = tags;
        this.mode = mode;
        this.context = context;
        this.next = next;
    }
    get opaque() { return this.mode == 0 /* Mode.Opaque */; }
    get inherit() { return this.mode == 1 /* Mode.Inherit */; }
    sort(other) {
        if (!other || other.depth < this.depth) {
            this.next = other;
            return this;
        }
        other.next = this.sort(other.next);
        return other;
    }
    get depth() { return this.context ? this.context.length : 0; }
}
Rule.empty = new Rule([], 2 /* Mode.Normal */, null);
/**
Define a [highlighter](#highlight.Highlighter) from an array of
tag/class pairs. Classes associated with more specific tags will
take precedence.
*/
function tagHighlighter(tags, options) {
    let map = Object.create(null);
    for (let style of tags) {
        if (!Array.isArray(style.tag))
            map[style.tag.id] = style.class;
        else
            for (let tag of style.tag)
                map[tag.id] = style.class;
    }
    let { scope, all = null } = options || {};
    return {
        style: (tags) => {
            let cls = all;
            for (let tag of tags) {
                for (let sub of tag.set) {
                    let tagClass = map[sub.id];
                    if (tagClass) {
                        cls = cls ? cls + " " + tagClass : tagClass;
                        break;
                    }
                }
            }
            return cls;
        },
        scope
    };
}
function highlightTags(highlighters, tags) {
    let result = null;
    for (let highlighter of highlighters) {
        let value = highlighter.style(tags);
        if (value)
            result = result ? result + " " + value : value;
    }
    return result;
}
/**
Highlight the given [tree](#common.Tree) with the given
[highlighter](#highlight.Highlighter). Often, the higher-level
[`highlightCode`](#highlight.highlightCode) function is easier to
use.
*/
function highlightTree(tree, highlighter, 
/**
Assign styling to a region of the text. Will be called, in order
of position, for any ranges where more than zero classes apply.
`classes` is a space separated string of CSS classes.
*/
putStyle, 
/**
The start of the range to highlight.
*/
from = 0, 
/**
The end of the range.
*/
to = tree.length) {
    let builder = new HighlightBuilder(from, Array.isArray(highlighter) ? highlighter : [highlighter], putStyle);
    builder.highlightRange(tree.cursor(), from, to, "", builder.highlighters);
    builder.flush(to);
}
class HighlightBuilder {
    constructor(at, highlighters, span) {
        this.at = at;
        this.highlighters = highlighters;
        this.span = span;
        this.class = "";
    }
    startSpan(at, cls) {
        if (cls != this.class) {
            this.flush(at);
            if (at > this.at)
                this.at = at;
            this.class = cls;
        }
    }
    flush(to) {
        if (to > this.at && this.class)
            this.span(this.at, to, this.class);
    }
    highlightRange(cursor, from, to, inheritedClass, highlighters) {
        let { type, from: start, to: end } = cursor;
        if (start >= to || end <= from)
            return;
        if (type.isTop)
            highlighters = this.highlighters.filter(h => !h.scope || h.scope(type));
        let cls = inheritedClass;
        let rule = getStyleTags(cursor) || Rule.empty;
        let tagCls = highlightTags(highlighters, rule.tags);
        if (tagCls) {
            if (cls)
                cls += " ";
            cls += tagCls;
            if (rule.mode == 1 /* Mode.Inherit */)
                inheritedClass += (inheritedClass ? " " : "") + tagCls;
        }
        this.startSpan(Math.max(from, start), cls);
        if (rule.opaque)
            return;
        let mounted = cursor.tree && cursor.tree.prop(NodeProp.mounted);
        if (mounted && mounted.overlay) {
            let inner = cursor.node.enter(mounted.overlay[0].from + start, 1);
            let innerHighlighters = this.highlighters.filter(h => !h.scope || h.scope(mounted.tree.type));
            let hasChild = cursor.firstChild();
            for (let i = 0, pos = start;; i++) {
                let next = i < mounted.overlay.length ? mounted.overlay[i] : null;
                let nextPos = next ? next.from + start : end;
                let rangeFrom = Math.max(from, pos), rangeTo = Math.min(to, nextPos);
                if (rangeFrom < rangeTo && hasChild) {
                    while (cursor.from < rangeTo) {
                        this.highlightRange(cursor, rangeFrom, rangeTo, inheritedClass, highlighters);
                        this.startSpan(Math.min(rangeTo, cursor.to), cls);
                        if (cursor.to >= nextPos || !cursor.nextSibling())
                            break;
                    }
                }
                if (!next || nextPos > to)
                    break;
                pos = next.to + start;
                if (pos > from) {
                    this.highlightRange(inner.cursor(), Math.max(from, next.from + start), Math.min(to, pos), "", innerHighlighters);
                    this.startSpan(Math.min(to, pos), cls);
                }
            }
            if (hasChild)
                cursor.parent();
        }
        else if (cursor.firstChild()) {
            if (mounted)
                inheritedClass = "";
            do {
                if (cursor.to <= from)
                    continue;
                if (cursor.from >= to)
                    break;
                this.highlightRange(cursor, from, to, inheritedClass, highlighters);
                this.startSpan(Math.min(to, cursor.to), cls);
            } while (cursor.nextSibling());
            cursor.parent();
        }
    }
}
/**
Match a syntax node's [highlight rules](#highlight.styleTags). If
there's a match, return its set of tags, and whether it is
opaque (uses a `!`) or applies to all child nodes (`/...`).
*/
function getStyleTags(node) {
    let rule = node.type.prop(ruleNodeProp);
    while (rule && rule.context && !node.matchContext(rule.context))
        rule = rule.next;
    return rule || null;
}
const t = Tag.define;
const comment = t(), name = t(), typeName = t(name), propertyName = t(name), literal = t(), string = t(literal), number = t(literal), content = t(), heading = t(content), keyword = t(), operator = t(), punctuation = t(), bracket = t(punctuation), meta = t();
/**
The default set of highlighting [tags](#highlight.Tag).

This collection is heavily biased towards programming languages,
and necessarily incomplete. A full ontology of syntactic
constructs would fill a stack of books, and be impractical to
write themes for. So try to make do with this set. If all else
fails, [open an
issue](https://github.com/codemirror/codemirror.next) to propose a
new tag, or [define](#highlight.Tag^define) a local custom tag for
your use case.

Note that it is not obligatory to always attach the most specific
tag possible to an element—if your grammar can't easily
distinguish a certain type of element (such as a local variable),
it is okay to style it as its more general variant (a variable).

For tags that extend some parent tag, the documentation links to
the parent.
*/
const tags = {
    /**
    A comment.
    */
    comment,
    /**
    A line [comment](#highlight.tags.comment).
    */
    lineComment: t(comment),
    /**
    A block [comment](#highlight.tags.comment).
    */
    blockComment: t(comment),
    /**
    A documentation [comment](#highlight.tags.comment).
    */
    docComment: t(comment),
    /**
    Any kind of identifier.
    */
    name,
    /**
    The [name](#highlight.tags.name) of a variable.
    */
    variableName: t(name),
    /**
    A type [name](#highlight.tags.name).
    */
    typeName: typeName,
    /**
    A tag name (subtag of [`typeName`](#highlight.tags.typeName)).
    */
    tagName: t(typeName),
    /**
    A property or field [name](#highlight.tags.name).
    */
    propertyName: propertyName,
    /**
    An attribute name (subtag of [`propertyName`](#highlight.tags.propertyName)).
    */
    attributeName: t(propertyName),
    /**
    The [name](#highlight.tags.name) of a class.
    */
    className: t(name),
    /**
    A label [name](#highlight.tags.name).
    */
    labelName: t(name),
    /**
    A namespace [name](#highlight.tags.name).
    */
    namespace: t(name),
    /**
    The [name](#highlight.tags.name) of a macro.
    */
    macroName: t(name),
    /**
    A literal value.
    */
    literal,
    /**
    A string [literal](#highlight.tags.literal).
    */
    string,
    /**
    A documentation [string](#highlight.tags.string).
    */
    docString: t(string),
    /**
    A character literal (subtag of [string](#highlight.tags.string)).
    */
    character: t(string),
    /**
    An attribute value (subtag of [string](#highlight.tags.string)).
    */
    attributeValue: t(string),
    /**
    A number [literal](#highlight.tags.literal).
    */
    number,
    /**
    An integer [number](#highlight.tags.number) literal.
    */
    integer: t(number),
    /**
    A floating-point [number](#highlight.tags.number) literal.
    */
    float: t(number),
    /**
    A boolean [literal](#highlight.tags.literal).
    */
    bool: t(literal),
    /**
    Regular expression [literal](#highlight.tags.literal).
    */
    regexp: t(literal),
    /**
    An escape [literal](#highlight.tags.literal), for example a
    backslash escape in a string.
    */
    escape: t(literal),
    /**
    A color [literal](#highlight.tags.literal).
    */
    color: t(literal),
    /**
    A URL [literal](#highlight.tags.literal).
    */
    url: t(literal),
    /**
    A language keyword.
    */
    keyword,
    /**
    The [keyword](#highlight.tags.keyword) for the self or this
    object.
    */
    self: t(keyword),
    /**
    The [keyword](#highlight.tags.keyword) for null.
    */
    null: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) denoting some atomic value.
    */
    atom: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) that represents a unit.
    */
    unit: t(keyword),
    /**
    A modifier [keyword](#highlight.tags.keyword).
    */
    modifier: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) that acts as an operator.
    */
    operatorKeyword: t(keyword),
    /**
    A control-flow related [keyword](#highlight.tags.keyword).
    */
    controlKeyword: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) that defines something.
    */
    definitionKeyword: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) related to defining or
    interfacing with modules.
    */
    moduleKeyword: t(keyword),
    /**
    An operator.
    */
    operator,
    /**
    An [operator](#highlight.tags.operator) that dereferences something.
    */
    derefOperator: t(operator),
    /**
    Arithmetic-related [operator](#highlight.tags.operator).
    */
    arithmeticOperator: t(operator),
    /**
    Logical [operator](#highlight.tags.operator).
    */
    logicOperator: t(operator),
    /**
    Bit [operator](#highlight.tags.operator).
    */
    bitwiseOperator: t(operator),
    /**
    Comparison [operator](#highlight.tags.operator).
    */
    compareOperator: t(operator),
    /**
    [Operator](#highlight.tags.operator) that updates its operand.
    */
    updateOperator: t(operator),
    /**
    [Operator](#highlight.tags.operator) that defines something.
    */
    definitionOperator: t(operator),
    /**
    Type-related [operator](#highlight.tags.operator).
    */
    typeOperator: t(operator),
    /**
    Control-flow [operator](#highlight.tags.operator).
    */
    controlOperator: t(operator),
    /**
    Program or markup punctuation.
    */
    punctuation,
    /**
    [Punctuation](#highlight.tags.punctuation) that separates
    things.
    */
    separator: t(punctuation),
    /**
    Bracket-style [punctuation](#highlight.tags.punctuation).
    */
    bracket,
    /**
    Angle [brackets](#highlight.tags.bracket) (usually `<` and `>`
    tokens).
    */
    angleBracket: t(bracket),
    /**
    Square [brackets](#highlight.tags.bracket) (usually `[` and `]`
    tokens).
    */
    squareBracket: t(bracket),
    /**
    Parentheses (usually `(` and `)` tokens). Subtag of
    [bracket](#highlight.tags.bracket).
    */
    paren: t(bracket),
    /**
    Braces (usually `{` and `}` tokens). Subtag of
    [bracket](#highlight.tags.bracket).
    */
    brace: t(bracket),
    /**
    Content, for example plain text in XML or markup documents.
    */
    content,
    /**
    [Content](#highlight.tags.content) that represents a heading.
    */
    heading,
    /**
    A level 1 [heading](#highlight.tags.heading).
    */
    heading1: t(heading),
    /**
    A level 2 [heading](#highlight.tags.heading).
    */
    heading2: t(heading),
    /**
    A level 3 [heading](#highlight.tags.heading).
    */
    heading3: t(heading),
    /**
    A level 4 [heading](#highlight.tags.heading).
    */
    heading4: t(heading),
    /**
    A level 5 [heading](#highlight.tags.heading).
    */
    heading5: t(heading),
    /**
    A level 6 [heading](#highlight.tags.heading).
    */
    heading6: t(heading),
    /**
    A prose separator (such as a horizontal rule).
    */
    contentSeparator: t(content),
    /**
    [Content](#highlight.tags.content) that represents a list.
    */
    list: t(content),
    /**
    [Content](#highlight.tags.content) that represents a quote.
    */
    quote: t(content),
    /**
    [Content](#highlight.tags.content) that is emphasized.
    */
    emphasis: t(content),
    /**
    [Content](#highlight.tags.content) that is styled strong.
    */
    strong: t(content),
    /**
    [Content](#highlight.tags.content) that is part of a link.
    */
    link: t(content),
    /**
    [Content](#highlight.tags.content) that is styled as code or
    monospace.
    */
    monospace: t(content),
    /**
    [Content](#highlight.tags.content) that has a strike-through
    style.
    */
    strikethrough: t(content),
    /**
    Inserted text in a change-tracking format.
    */
    inserted: t(),
    /**
    Deleted text.
    */
    deleted: t(),
    /**
    Changed text.
    */
    changed: t(),
    /**
    An invalid or unsyntactic element.
    */
    invalid: t(),
    /**
    Metadata or meta-instruction.
    */
    meta,
    /**
    [Metadata](#highlight.tags.meta) that applies to the entire
    document.
    */
    documentMeta: t(meta),
    /**
    [Metadata](#highlight.tags.meta) that annotates or adds
    attributes to a given syntactic element.
    */
    annotation: t(meta),
    /**
    Processing instruction or preprocessor directive. Subtag of
    [meta](#highlight.tags.meta).
    */
    processingInstruction: t(meta),
    /**
    [Modifier](#highlight.Tag^defineModifier) that indicates that a
    given element is being defined. Expected to be used with the
    various [name](#highlight.tags.name) tags.
    */
    definition: Tag.defineModifier(),
    /**
    [Modifier](#highlight.Tag^defineModifier) that indicates that
    something is constant. Mostly expected to be used with
    [variable names](#highlight.tags.variableName).
    */
    constant: Tag.defineModifier(),
    /**
    [Modifier](#highlight.Tag^defineModifier) used to indicate that
    a [variable](#highlight.tags.variableName) or [property
    name](#highlight.tags.propertyName) is being called or defined
    as a function.
    */
    function: Tag.defineModifier(),
    /**
    [Modifier](#highlight.Tag^defineModifier) that can be applied to
    [names](#highlight.tags.name) to indicate that they belong to
    the language's standard environment.
    */
    standard: Tag.defineModifier(),
    /**
    [Modifier](#highlight.Tag^defineModifier) that indicates a given
    [names](#highlight.tags.name) is local to some scope.
    */
    local: Tag.defineModifier(),
    /**
    A generic variant [modifier](#highlight.Tag^defineModifier) that
    can be used to tag language-specific alternative variants of
    some common tag. It is recommended for themes to define special
    forms of at least the [string](#highlight.tags.string) and
    [variable name](#highlight.tags.variableName) tags, since those
    come up a lot.
    */
    special: Tag.defineModifier()
};
/**
This is a highlighter that adds stable, predictable classes to
tokens, for styling with external CSS.

The following tags are mapped to their name prefixed with `"tok-"`
(for example `"tok-comment"`):

* [`link`](#highlight.tags.link)
* [`heading`](#highlight.tags.heading)
* [`emphasis`](#highlight.tags.emphasis)
* [`strong`](#highlight.tags.strong)
* [`keyword`](#highlight.tags.keyword)
* [`atom`](#highlight.tags.atom)
* [`bool`](#highlight.tags.bool)
* [`url`](#highlight.tags.url)
* [`labelName`](#highlight.tags.labelName)
* [`inserted`](#highlight.tags.inserted)
* [`deleted`](#highlight.tags.deleted)
* [`literal`](#highlight.tags.literal)
* [`string`](#highlight.tags.string)
* [`number`](#highlight.tags.number)
* [`variableName`](#highlight.tags.variableName)
* [`typeName`](#highlight.tags.typeName)
* [`namespace`](#highlight.tags.namespace)
* [`className`](#highlight.tags.className)
* [`macroName`](#highlight.tags.macroName)
* [`propertyName`](#highlight.tags.propertyName)
* [`operator`](#highlight.tags.operator)
* [`comment`](#highlight.tags.comment)
* [`meta`](#highlight.tags.meta)
* [`punctuation`](#highlight.tags.punctuation)
* [`invalid`](#highlight.tags.invalid)

In addition, these mappings are provided:

* [`regexp`](#highlight.tags.regexp),
  [`escape`](#highlight.tags.escape), and
  [`special`](#highlight.tags.special)[`(string)`](#highlight.tags.string)
  are mapped to `"tok-string2"`
* [`special`](#highlight.tags.special)[`(variableName)`](#highlight.tags.variableName)
  to `"tok-variableName2"`
* [`local`](#highlight.tags.local)[`(variableName)`](#highlight.tags.variableName)
  to `"tok-variableName tok-local"`
* [`definition`](#highlight.tags.definition)[`(variableName)`](#highlight.tags.variableName)
  to `"tok-variableName tok-definition"`
* [`definition`](#highlight.tags.definition)[`(propertyName)`](#highlight.tags.propertyName)
  to `"tok-propertyName tok-definition"`
*/
tagHighlighter([
    { tag: tags.link, class: "tok-link" },
    { tag: tags.heading, class: "tok-heading" },
    { tag: tags.emphasis, class: "tok-emphasis" },
    { tag: tags.strong, class: "tok-strong" },
    { tag: tags.keyword, class: "tok-keyword" },
    { tag: tags.atom, class: "tok-atom" },
    { tag: tags.bool, class: "tok-bool" },
    { tag: tags.url, class: "tok-url" },
    { tag: tags.labelName, class: "tok-labelName" },
    { tag: tags.inserted, class: "tok-inserted" },
    { tag: tags.deleted, class: "tok-deleted" },
    { tag: tags.literal, class: "tok-literal" },
    { tag: tags.string, class: "tok-string" },
    { tag: tags.number, class: "tok-number" },
    { tag: [tags.regexp, tags.escape, tags.special(tags.string)], class: "tok-string2" },
    { tag: tags.variableName, class: "tok-variableName" },
    { tag: tags.local(tags.variableName), class: "tok-variableName tok-local" },
    { tag: tags.definition(tags.variableName), class: "tok-variableName tok-definition" },
    { tag: tags.special(tags.variableName), class: "tok-variableName2" },
    { tag: tags.definition(tags.propertyName), class: "tok-propertyName tok-definition" },
    { tag: tags.typeName, class: "tok-typeName" },
    { tag: tags.namespace, class: "tok-namespace" },
    { tag: tags.className, class: "tok-className" },
    { tag: tags.macroName, class: "tok-macroName" },
    { tag: tags.propertyName, class: "tok-propertyName" },
    { tag: tags.operator, class: "tok-operator" },
    { tag: tags.comment, class: "tok-comment" },
    { tag: tags.meta, class: "tok-meta" },
    { tag: tags.invalid, class: "tok-invalid" },
    { tag: tags.punctuation, class: "tok-punctuation" }
]);

var _a;
/**
Node prop stored in a parser's top syntax node to provide the
facet that stores language-specific data for that language.
*/
const languageDataProp = /*@__PURE__*/new NodeProp();
/**
Helper function to define a facet (to be added to the top syntax
node(s) for a language via
[`languageDataProp`](https://codemirror.net/6/docs/ref/#language.languageDataProp)), that will be
used to associate language data with the language. You
probably only need this when subclassing
[`Language`](https://codemirror.net/6/docs/ref/#language.Language).
*/
function defineLanguageFacet(baseData) {
    return Facet.define({
        combine: baseData ? values => values.concat(baseData) : undefined
    });
}
/**
Syntax node prop used to register sublanguages. Should be added to
the top level node type for the language.
*/
const sublanguageProp = /*@__PURE__*/new NodeProp();
/**
A language object manages parsing and per-language
[metadata](https://codemirror.net/6/docs/ref/#state.EditorState.languageDataAt). Parse data is
managed as a [Lezer](https://lezer.codemirror.net) tree. The class
can be used directly, via the [`LRLanguage`](https://codemirror.net/6/docs/ref/#language.LRLanguage)
subclass for [Lezer](https://lezer.codemirror.net/) LR parsers, or
via the [`StreamLanguage`](https://codemirror.net/6/docs/ref/#language.StreamLanguage) subclass
for stream parsers.
*/
class Language {
    /**
    Construct a language object. If you need to invoke this
    directly, first define a data facet with
    [`defineLanguageFacet`](https://codemirror.net/6/docs/ref/#language.defineLanguageFacet), and then
    configure your parser to [attach](https://codemirror.net/6/docs/ref/#language.languageDataProp) it
    to the language's outer syntax node.
    */
    constructor(
    /**
    The [language data](https://codemirror.net/6/docs/ref/#state.EditorState.languageDataAt) facet
    used for this language.
    */
    data, parser, extraExtensions = [], 
    /**
    A language name.
    */
    name = "") {
        this.data = data;
        this.name = name;
        // Kludge to define EditorState.tree as a debugging helper,
        // without the EditorState package actually knowing about
        // languages and lezer trees.
        if (!EditorState.prototype.hasOwnProperty("tree"))
            Object.defineProperty(EditorState.prototype, "tree", { get() { return syntaxTree(this); } });
        this.parser = parser;
        this.extension = [
            language.of(this),
            EditorState.languageData.of((state, pos, side) => {
                let top = topNodeAt(state, pos, side), data = top.type.prop(languageDataProp);
                if (!data)
                    return [];
                let base = state.facet(data), sub = top.type.prop(sublanguageProp);
                if (sub) {
                    let innerNode = top.resolve(pos - top.from, side);
                    for (let sublang of sub)
                        if (sublang.test(innerNode, state)) {
                            let data = state.facet(sublang.facet);
                            return sublang.type == "replace" ? data : data.concat(base);
                        }
                }
                return base;
            })
        ].concat(extraExtensions);
    }
    /**
    Query whether this language is active at the given position.
    */
    isActiveAt(state, pos, side = -1) {
        return topNodeAt(state, pos, side).type.prop(languageDataProp) == this.data;
    }
    /**
    Find the document regions that were parsed using this language.
    The returned regions will _include_ any nested languages rooted
    in this language, when those exist.
    */
    findRegions(state) {
        let lang = state.facet(language);
        if ((lang === null || lang === void 0 ? void 0 : lang.data) == this.data)
            return [{ from: 0, to: state.doc.length }];
        if (!lang || !lang.allowsNesting)
            return [];
        let result = [];
        let explore = (tree, from) => {
            if (tree.prop(languageDataProp) == this.data) {
                result.push({ from, to: from + tree.length });
                return;
            }
            let mount = tree.prop(NodeProp.mounted);
            if (mount) {
                if (mount.tree.prop(languageDataProp) == this.data) {
                    if (mount.overlay)
                        for (let r of mount.overlay)
                            result.push({ from: r.from + from, to: r.to + from });
                    else
                        result.push({ from: from, to: from + tree.length });
                    return;
                }
                else if (mount.overlay) {
                    let size = result.length;
                    explore(mount.tree, mount.overlay[0].from + from);
                    if (result.length > size)
                        return;
                }
            }
            for (let i = 0; i < tree.children.length; i++) {
                let ch = tree.children[i];
                if (ch instanceof Tree)
                    explore(ch, tree.positions[i] + from);
            }
        };
        explore(syntaxTree(state), 0);
        return result;
    }
    /**
    Indicates whether this language allows nested languages. The
    default implementation returns true.
    */
    get allowsNesting() { return true; }
}
/**
@internal
*/
Language.setState = /*@__PURE__*/StateEffect.define();
function topNodeAt(state, pos, side) {
    let topLang = state.facet(language), tree = syntaxTree(state).topNode;
    if (!topLang || topLang.allowsNesting) {
        for (let node = tree; node; node = node.enter(pos, side, IterMode.ExcludeBuffers))
            if (node.type.isTop)
                tree = node;
    }
    return tree;
}
/**
A subclass of [`Language`](https://codemirror.net/6/docs/ref/#language.Language) for use with Lezer
[LR parsers](https://lezer.codemirror.net/docs/ref#lr.LRParser)
parsers.
*/
class LRLanguage extends Language {
    constructor(data, parser, name) {
        super(data, parser, [], name);
        this.parser = parser;
    }
    /**
    Define a language from a parser.
    */
    static define(spec) {
        let data = defineLanguageFacet(spec.languageData);
        return new LRLanguage(data, spec.parser.configure({
            props: [languageDataProp.add(type => type.isTop ? data : undefined)]
        }), spec.name);
    }
    /**
    Create a new instance of this language with a reconfigured
    version of its parser and optionally a new name.
    */
    configure(options, name) {
        return new LRLanguage(this.data, this.parser.configure(options), name || this.name);
    }
    get allowsNesting() { return this.parser.hasWrappers(); }
}
/**
Get the syntax tree for a state, which is the current (possibly
incomplete) parse tree of the active
[language](https://codemirror.net/6/docs/ref/#language.Language), or the empty tree if there is no
language available.
*/
function syntaxTree(state) {
    let field = state.field(Language.state, false);
    return field ? field.tree : Tree.empty;
}
/**
Lezer-style
[`Input`](https://lezer.codemirror.net/docs/ref#common.Input)
object for a [`Text`](https://codemirror.net/6/docs/ref/#state.Text) object.
*/
class DocInput {
    /**
    Create an input object for the given document.
    */
    constructor(doc) {
        this.doc = doc;
        this.cursorPos = 0;
        this.string = "";
        this.cursor = doc.iter();
    }
    get length() { return this.doc.length; }
    syncTo(pos) {
        this.string = this.cursor.next(pos - this.cursorPos).value;
        this.cursorPos = pos + this.string.length;
        return this.cursorPos - this.string.length;
    }
    chunk(pos) {
        this.syncTo(pos);
        return this.string;
    }
    get lineChunks() { return true; }
    read(from, to) {
        let stringStart = this.cursorPos - this.string.length;
        if (from < stringStart || to >= this.cursorPos)
            return this.doc.sliceString(from, to);
        else
            return this.string.slice(from - stringStart, to - stringStart);
    }
}
let currentContext = null;
/**
A parse context provided to parsers working on the editor content.
*/
class ParseContext {
    constructor(parser, 
    /**
    The current editor state.
    */
    state, 
    /**
    Tree fragments that can be reused by incremental re-parses.
    */
    fragments = [], 
    /**
    @internal
    */
    tree, 
    /**
    @internal
    */
    treeLen, 
    /**
    The current editor viewport (or some overapproximation
    thereof). Intended to be used for opportunistically avoiding
    work (in which case
    [`skipUntilInView`](https://codemirror.net/6/docs/ref/#language.ParseContext.skipUntilInView)
    should be called to make sure the parser is restarted when the
    skipped region becomes visible).
    */
    viewport, 
    /**
    @internal
    */
    skipped, 
    /**
    This is where skipping parsers can register a promise that,
    when resolved, will schedule a new parse. It is cleared when
    the parse worker picks up the promise. @internal
    */
    scheduleOn) {
        this.parser = parser;
        this.state = state;
        this.fragments = fragments;
        this.tree = tree;
        this.treeLen = treeLen;
        this.viewport = viewport;
        this.skipped = skipped;
        this.scheduleOn = scheduleOn;
        this.parse = null;
        /**
        @internal
        */
        this.tempSkipped = [];
    }
    /**
    @internal
    */
    static create(parser, state, viewport) {
        return new ParseContext(parser, state, [], Tree.empty, 0, viewport, [], null);
    }
    startParse() {
        return this.parser.startParse(new DocInput(this.state.doc), this.fragments);
    }
    /**
    @internal
    */
    work(until, upto) {
        if (upto != null && upto >= this.state.doc.length)
            upto = undefined;
        if (this.tree != Tree.empty && this.isDone(upto !== null && upto !== void 0 ? upto : this.state.doc.length)) {
            this.takeTree();
            return true;
        }
        return this.withContext(() => {
            var _a;
            if (typeof until == "number") {
                let endTime = Date.now() + until;
                until = () => Date.now() > endTime;
            }
            if (!this.parse)
                this.parse = this.startParse();
            if (upto != null && (this.parse.stoppedAt == null || this.parse.stoppedAt > upto) &&
                upto < this.state.doc.length)
                this.parse.stopAt(upto);
            for (;;) {
                let done = this.parse.advance();
                if (done) {
                    this.fragments = this.withoutTempSkipped(TreeFragment.addTree(done, this.fragments, this.parse.stoppedAt != null));
                    this.treeLen = (_a = this.parse.stoppedAt) !== null && _a !== void 0 ? _a : this.state.doc.length;
                    this.tree = done;
                    this.parse = null;
                    if (this.treeLen < (upto !== null && upto !== void 0 ? upto : this.state.doc.length))
                        this.parse = this.startParse();
                    else
                        return true;
                }
                if (until())
                    return false;
            }
        });
    }
    /**
    @internal
    */
    takeTree() {
        let pos, tree;
        if (this.parse && (pos = this.parse.parsedPos) >= this.treeLen) {
            if (this.parse.stoppedAt == null || this.parse.stoppedAt > pos)
                this.parse.stopAt(pos);
            this.withContext(() => { while (!(tree = this.parse.advance())) { } });
            this.treeLen = pos;
            this.tree = tree;
            this.fragments = this.withoutTempSkipped(TreeFragment.addTree(this.tree, this.fragments, true));
            this.parse = null;
        }
    }
    withContext(f) {
        let prev = currentContext;
        currentContext = this;
        try {
            return f();
        }
        finally {
            currentContext = prev;
        }
    }
    withoutTempSkipped(fragments) {
        for (let r; r = this.tempSkipped.pop();)
            fragments = cutFragments(fragments, r.from, r.to);
        return fragments;
    }
    /**
    @internal
    */
    changes(changes, newState) {
        let { fragments, tree, treeLen, viewport, skipped } = this;
        this.takeTree();
        if (!changes.empty) {
            let ranges = [];
            changes.iterChangedRanges((fromA, toA, fromB, toB) => ranges.push({ fromA, toA, fromB, toB }));
            fragments = TreeFragment.applyChanges(fragments, ranges);
            tree = Tree.empty;
            treeLen = 0;
            viewport = { from: changes.mapPos(viewport.from, -1), to: changes.mapPos(viewport.to, 1) };
            if (this.skipped.length) {
                skipped = [];
                for (let r of this.skipped) {
                    let from = changes.mapPos(r.from, 1), to = changes.mapPos(r.to, -1);
                    if (from < to)
                        skipped.push({ from, to });
                }
            }
        }
        return new ParseContext(this.parser, newState, fragments, tree, treeLen, viewport, skipped, this.scheduleOn);
    }
    /**
    @internal
    */
    updateViewport(viewport) {
        if (this.viewport.from == viewport.from && this.viewport.to == viewport.to)
            return false;
        this.viewport = viewport;
        let startLen = this.skipped.length;
        for (let i = 0; i < this.skipped.length; i++) {
            let { from, to } = this.skipped[i];
            if (from < viewport.to && to > viewport.from) {
                this.fragments = cutFragments(this.fragments, from, to);
                this.skipped.splice(i--, 1);
            }
        }
        if (this.skipped.length >= startLen)
            return false;
        this.reset();
        return true;
    }
    /**
    @internal
    */
    reset() {
        if (this.parse) {
            this.takeTree();
            this.parse = null;
        }
    }
    /**
    Notify the parse scheduler that the given region was skipped
    because it wasn't in view, and the parse should be restarted
    when it comes into view.
    */
    skipUntilInView(from, to) {
        this.skipped.push({ from, to });
    }
    /**
    Returns a parser intended to be used as placeholder when
    asynchronously loading a nested parser. It'll skip its input and
    mark it as not-really-parsed, so that the next update will parse
    it again.
    
    When `until` is given, a reparse will be scheduled when that
    promise resolves.
    */
    static getSkippingParser(until) {
        return new class extends Parser {
            createParse(input, fragments, ranges) {
                let from = ranges[0].from, to = ranges[ranges.length - 1].to;
                let parser = {
                    parsedPos: from,
                    advance() {
                        let cx = currentContext;
                        if (cx) {
                            for (let r of ranges)
                                cx.tempSkipped.push(r);
                            if (until)
                                cx.scheduleOn = cx.scheduleOn ? Promise.all([cx.scheduleOn, until]) : until;
                        }
                        this.parsedPos = to;
                        return new Tree(NodeType.none, [], [], to - from);
                    },
                    stoppedAt: null,
                    stopAt() { }
                };
                return parser;
            }
        };
    }
    /**
    @internal
    */
    isDone(upto) {
        upto = Math.min(upto, this.state.doc.length);
        let frags = this.fragments;
        return this.treeLen >= upto && frags.length && frags[0].from == 0 && frags[0].to >= upto;
    }
    /**
    Get the context for the current parse, or `null` if no editor
    parse is in progress.
    */
    static get() { return currentContext; }
}
function cutFragments(fragments, from, to) {
    return TreeFragment.applyChanges(fragments, [{ fromA: from, toA: to, fromB: from, toB: to }]);
}
class LanguageState {
    constructor(
    // A mutable parse state that is used to preserve work done during
    // the lifetime of a state when moving to the next state.
    context) {
        this.context = context;
        this.tree = context.tree;
    }
    apply(tr) {
        if (!tr.docChanged && this.tree == this.context.tree)
            return this;
        let newCx = this.context.changes(tr.changes, tr.state);
        // If the previous parse wasn't done, go forward only up to its
        // end position or the end of the viewport, to avoid slowing down
        // state updates with parse work beyond the viewport.
        let upto = this.context.treeLen == tr.startState.doc.length ? undefined
            : Math.max(tr.changes.mapPos(this.context.treeLen), newCx.viewport.to);
        if (!newCx.work(20 /* Work.Apply */, upto))
            newCx.takeTree();
        return new LanguageState(newCx);
    }
    static init(state) {
        let vpTo = Math.min(3000 /* Work.InitViewport */, state.doc.length);
        let parseState = ParseContext.create(state.facet(language).parser, state, { from: 0, to: vpTo });
        if (!parseState.work(20 /* Work.Apply */, vpTo))
            parseState.takeTree();
        return new LanguageState(parseState);
    }
}
Language.state = /*@__PURE__*/StateField.define({
    create: LanguageState.init,
    update(value, tr) {
        for (let e of tr.effects)
            if (e.is(Language.setState))
                return e.value;
        if (tr.startState.facet(language) != tr.state.facet(language))
            return LanguageState.init(tr.state);
        return value.apply(tr);
    }
});
let requestIdle = (callback) => {
    let timeout = setTimeout(() => callback(), 500 /* Work.MaxPause */);
    return () => clearTimeout(timeout);
};
if (typeof requestIdleCallback != "undefined")
    requestIdle = (callback) => {
        let idle = -1, timeout = setTimeout(() => {
            idle = requestIdleCallback(callback, { timeout: 500 /* Work.MaxPause */ - 100 /* Work.MinPause */ });
        }, 100 /* Work.MinPause */);
        return () => idle < 0 ? clearTimeout(timeout) : cancelIdleCallback(idle);
    };
const isInputPending = typeof navigator != "undefined" && ((_a = navigator.scheduling) === null || _a === void 0 ? void 0 : _a.isInputPending)
    ? () => navigator.scheduling.isInputPending() : null;
const parseWorker = /*@__PURE__*/ViewPlugin.fromClass(class ParseWorker {
    constructor(view) {
        this.view = view;
        this.working = null;
        this.workScheduled = 0;
        // End of the current time chunk
        this.chunkEnd = -1;
        // Milliseconds of budget left for this chunk
        this.chunkBudget = -1;
        this.work = this.work.bind(this);
        this.scheduleWork();
    }
    update(update) {
        let cx = this.view.state.field(Language.state).context;
        if (cx.updateViewport(update.view.viewport) || this.view.viewport.to > cx.treeLen)
            this.scheduleWork();
        if (update.docChanged || update.selectionSet) {
            if (this.view.hasFocus)
                this.chunkBudget += 50 /* Work.ChangeBonus */;
            this.scheduleWork();
        }
        this.checkAsyncSchedule(cx);
    }
    scheduleWork() {
        if (this.working)
            return;
        let { state } = this.view, field = state.field(Language.state);
        if (field.tree != field.context.tree || !field.context.isDone(state.doc.length))
            this.working = requestIdle(this.work);
    }
    work(deadline) {
        this.working = null;
        let now = Date.now();
        if (this.chunkEnd < now && (this.chunkEnd < 0 || this.view.hasFocus)) { // Start a new chunk
            this.chunkEnd = now + 30000 /* Work.ChunkTime */;
            this.chunkBudget = 3000 /* Work.ChunkBudget */;
        }
        if (this.chunkBudget <= 0)
            return; // No more budget
        let { state, viewport: { to: vpTo } } = this.view, field = state.field(Language.state);
        if (field.tree == field.context.tree && field.context.isDone(vpTo + 100000 /* Work.MaxParseAhead */))
            return;
        let endTime = Date.now() + Math.min(this.chunkBudget, 100 /* Work.Slice */, deadline && !isInputPending ? Math.max(25 /* Work.MinSlice */, deadline.timeRemaining() - 5) : 1e9);
        let viewportFirst = field.context.treeLen < vpTo && state.doc.length > vpTo + 1000;
        let done = field.context.work(() => {
            return isInputPending && isInputPending() || Date.now() > endTime;
        }, vpTo + (viewportFirst ? 0 : 100000 /* Work.MaxParseAhead */));
        this.chunkBudget -= Date.now() - now;
        if (done || this.chunkBudget <= 0) {
            field.context.takeTree();
            this.view.dispatch({ effects: Language.setState.of(new LanguageState(field.context)) });
        }
        if (this.chunkBudget > 0 && !(done && !viewportFirst))
            this.scheduleWork();
        this.checkAsyncSchedule(field.context);
    }
    checkAsyncSchedule(cx) {
        if (cx.scheduleOn) {
            this.workScheduled++;
            cx.scheduleOn
                .then(() => this.scheduleWork())
                .catch(err => logException(this.view.state, err))
                .then(() => this.workScheduled--);
            cx.scheduleOn = null;
        }
    }
    destroy() {
        if (this.working)
            this.working();
    }
    isWorking() {
        return !!(this.working || this.workScheduled > 0);
    }
}, {
    eventHandlers: { focus() { this.scheduleWork(); } }
});
/**
The facet used to associate a language with an editor state. Used
by `Language` object's `extension` property (so you don't need to
manually wrap your languages in this). Can be used to access the
current language on a state.
*/
const language = /*@__PURE__*/Facet.define({
    combine(languages) { return languages.length ? languages[0] : null; },
    enables: language => [
        Language.state,
        parseWorker,
        EditorView.contentAttributes.compute([language], state => {
            let lang = state.facet(language);
            return lang && lang.name ? { "data-language": lang.name } : {};
        })
    ]
});
/**
This class bundles a [language](https://codemirror.net/6/docs/ref/#language.Language) with an
optional set of supporting extensions. Language packages are
encouraged to export a function that optionally takes a
configuration object and returns a `LanguageSupport` instance, as
the main way for client code to use the package.
*/
class LanguageSupport {
    /**
    Create a language support object.
    */
    constructor(
    /**
    The language object.
    */
    language, 
    /**
    An optional set of supporting extensions. When nesting a
    language in another language, the outer language is encouraged
    to include the supporting extensions for its inner languages
    in its own set of support extensions.
    */
    support = []) {
        this.language = language;
        this.support = support;
        this.extension = [language, support];
    }
}

/**
Facet that defines a way to provide a function that computes the
appropriate indentation depth, as a column number (see
[`indentString`](https://codemirror.net/6/docs/ref/#language.indentString)), at the start of a given
line. A return value of `null` indicates no indentation can be
determined, and the line should inherit the indentation of the one
above it. A return value of `undefined` defers to the next indent
service.
*/
const indentService = /*@__PURE__*/Facet.define();
/**
Facet for overriding the unit by which indentation happens. Should
be a string consisting either entirely of the same whitespace
character. When not set, this defaults to 2 spaces.
*/
const indentUnit = /*@__PURE__*/Facet.define({
    combine: values => {
        if (!values.length)
            return "  ";
        let unit = values[0];
        if (!unit || /\S/.test(unit) || Array.from(unit).some(e => e != unit[0]))
            throw new Error("Invalid indent unit: " + JSON.stringify(values[0]));
        return unit;
    }
});
/**
Return the _column width_ of an indent unit in the state.
Determined by the [`indentUnit`](https://codemirror.net/6/docs/ref/#language.indentUnit)
facet, and [`tabSize`](https://codemirror.net/6/docs/ref/#state.EditorState^tabSize) when that
contains tabs.
*/
function getIndentUnit(state) {
    let unit = state.facet(indentUnit);
    return unit.charCodeAt(0) == 9 ? state.tabSize * unit.length : unit.length;
}
/**
Create an indentation string that covers columns 0 to `cols`.
Will use tabs for as much of the columns as possible when the
[`indentUnit`](https://codemirror.net/6/docs/ref/#language.indentUnit) facet contains
tabs.
*/
function indentString(state, cols) {
    let result = "", ts = state.tabSize, ch = state.facet(indentUnit)[0];
    if (ch == "\t") {
        while (cols >= ts) {
            result += "\t";
            cols -= ts;
        }
        ch = " ";
    }
    for (let i = 0; i < cols; i++)
        result += ch;
    return result;
}
/**
Get the indentation, as a column number, at the given position.
Will first consult any [indent services](https://codemirror.net/6/docs/ref/#language.indentService)
that are registered, and if none of those return an indentation,
this will check the syntax tree for the [indent node
prop](https://codemirror.net/6/docs/ref/#language.indentNodeProp) and use that if found. Returns a
number when an indentation could be determined, and null
otherwise.
*/
function getIndentation(context, pos) {
    if (context instanceof EditorState)
        context = new IndentContext(context);
    for (let service of context.state.facet(indentService)) {
        let result = service(context, pos);
        if (result !== undefined)
            return result;
    }
    let tree = syntaxTree(context.state);
    return tree.length >= pos ? syntaxIndentation(context, tree, pos) : null;
}
/**
Indentation contexts are used when calling [indentation
services](https://codemirror.net/6/docs/ref/#language.indentService). They provide helper utilities
useful in indentation logic, and can selectively override the
indentation reported for some lines.
*/
class IndentContext {
    /**
    Create an indent context.
    */
    constructor(
    /**
    The editor state.
    */
    state, 
    /**
    @internal
    */
    options = {}) {
        this.state = state;
        this.options = options;
        this.unit = getIndentUnit(state);
    }
    /**
    Get a description of the line at the given position, taking
    [simulated line
    breaks](https://codemirror.net/6/docs/ref/#language.IndentContext.constructor^options.simulateBreak)
    into account. If there is such a break at `pos`, the `bias`
    argument determines whether the part of the line line before or
    after the break is used.
    */
    lineAt(pos, bias = 1) {
        let line = this.state.doc.lineAt(pos);
        let { simulateBreak, simulateDoubleBreak } = this.options;
        if (simulateBreak != null && simulateBreak >= line.from && simulateBreak <= line.to) {
            if (simulateDoubleBreak && simulateBreak == pos)
                return { text: "", from: pos };
            else if (bias < 0 ? simulateBreak < pos : simulateBreak <= pos)
                return { text: line.text.slice(simulateBreak - line.from), from: simulateBreak };
            else
                return { text: line.text.slice(0, simulateBreak - line.from), from: line.from };
        }
        return line;
    }
    /**
    Get the text directly after `pos`, either the entire line
    or the next 100 characters, whichever is shorter.
    */
    textAfterPos(pos, bias = 1) {
        if (this.options.simulateDoubleBreak && pos == this.options.simulateBreak)
            return "";
        let { text, from } = this.lineAt(pos, bias);
        return text.slice(pos - from, Math.min(text.length, pos + 100 - from));
    }
    /**
    Find the column for the given position.
    */
    column(pos, bias = 1) {
        let { text, from } = this.lineAt(pos, bias);
        let result = this.countColumn(text, pos - from);
        let override = this.options.overrideIndentation ? this.options.overrideIndentation(from) : -1;
        if (override > -1)
            result += override - this.countColumn(text, text.search(/\S|$/));
        return result;
    }
    /**
    Find the column position (taking tabs into account) of the given
    position in the given string.
    */
    countColumn(line, pos = line.length) {
        return countColumn(line, this.state.tabSize, pos);
    }
    /**
    Find the indentation column of the line at the given point.
    */
    lineIndent(pos, bias = 1) {
        let { text, from } = this.lineAt(pos, bias);
        let override = this.options.overrideIndentation;
        if (override) {
            let overriden = override(from);
            if (overriden > -1)
                return overriden;
        }
        return this.countColumn(text, text.search(/\S|$/));
    }
    /**
    Returns the [simulated line
    break](https://codemirror.net/6/docs/ref/#language.IndentContext.constructor^options.simulateBreak)
    for this context, if any.
    */
    get simulatedBreak() {
        return this.options.simulateBreak || null;
    }
}
/**
A syntax tree node prop used to associate indentation strategies
with node types. Such a strategy is a function from an indentation
context to a column number (see also
[`indentString`](https://codemirror.net/6/docs/ref/#language.indentString)) or null, where null
indicates that no definitive indentation can be determined.
*/
const indentNodeProp = /*@__PURE__*/new NodeProp();
// Compute the indentation for a given position from the syntax tree.
function syntaxIndentation(cx, ast, pos) {
    let stack = ast.resolveStack(pos);
    let inner = stack.node.enterUnfinishedNodesBefore(pos);
    if (inner != stack.node) {
        let add = [];
        for (let cur = inner; cur != stack.node; cur = cur.parent)
            add.push(cur);
        for (let i = add.length - 1; i >= 0; i--)
            stack = { node: add[i], next: stack };
    }
    return indentFor(stack, cx, pos);
}
function indentFor(stack, cx, pos) {
    for (let cur = stack; cur; cur = cur.next) {
        let strategy = indentStrategy(cur.node);
        if (strategy)
            return strategy(TreeIndentContext.create(cx, pos, cur));
    }
    return 0;
}
function ignoreClosed(cx) {
    return cx.pos == cx.options.simulateBreak && cx.options.simulateDoubleBreak;
}
function indentStrategy(tree) {
    let strategy = tree.type.prop(indentNodeProp);
    if (strategy)
        return strategy;
    let first = tree.firstChild, close;
    if (first && (close = first.type.prop(NodeProp.closedBy))) {
        let last = tree.lastChild, closed = last && close.indexOf(last.name) > -1;
        return cx => delimitedStrategy(cx, true, 1, undefined, closed && !ignoreClosed(cx) ? last.from : undefined);
    }
    return tree.parent == null ? topIndent : null;
}
function topIndent() { return 0; }
/**
Objects of this type provide context information and helper
methods to indentation functions registered on syntax nodes.
*/
class TreeIndentContext extends IndentContext {
    constructor(base, 
    /**
    The position at which indentation is being computed.
    */
    pos, 
    /**
    @internal
    */
    context) {
        super(base.state, base.options);
        this.base = base;
        this.pos = pos;
        this.context = context;
    }
    /**
    The syntax tree node to which the indentation strategy
    applies.
    */
    get node() { return this.context.node; }
    /**
    @internal
    */
    static create(base, pos, context) {
        return new TreeIndentContext(base, pos, context);
    }
    /**
    Get the text directly after `this.pos`, either the entire line
    or the next 100 characters, whichever is shorter.
    */
    get textAfter() {
        return this.textAfterPos(this.pos);
    }
    /**
    Get the indentation at the reference line for `this.node`, which
    is the line on which it starts, unless there is a node that is
    _not_ a parent of this node covering the start of that line. If
    so, the line at the start of that node is tried, again skipping
    on if it is covered by another such node.
    */
    get baseIndent() {
        return this.baseIndentFor(this.node);
    }
    /**
    Get the indentation for the reference line of the given node
    (see [`baseIndent`](https://codemirror.net/6/docs/ref/#language.TreeIndentContext.baseIndent)).
    */
    baseIndentFor(node) {
        let line = this.state.doc.lineAt(node.from);
        // Skip line starts that are covered by a sibling (or cousin, etc)
        for (;;) {
            let atBreak = node.resolve(line.from);
            while (atBreak.parent && atBreak.parent.from == atBreak.from)
                atBreak = atBreak.parent;
            if (isParent(atBreak, node))
                break;
            line = this.state.doc.lineAt(atBreak.from);
        }
        return this.lineIndent(line.from);
    }
    /**
    Continue looking for indentations in the node's parent nodes,
    and return the result of that.
    */
    continue() {
        return indentFor(this.context.next, this.base, this.pos);
    }
}
function isParent(parent, of) {
    for (let cur = of; cur; cur = cur.parent)
        if (parent == cur)
            return true;
    return false;
}
// Check whether a delimited node is aligned (meaning there are
// non-skipped nodes on the same line as the opening delimiter). And
// if so, return the opening token.
function bracketedAligned(context) {
    let tree = context.node;
    let openToken = tree.childAfter(tree.from), last = tree.lastChild;
    if (!openToken)
        return null;
    let sim = context.options.simulateBreak;
    let openLine = context.state.doc.lineAt(openToken.from);
    let lineEnd = sim == null || sim <= openLine.from ? openLine.to : Math.min(openLine.to, sim);
    for (let pos = openToken.to;;) {
        let next = tree.childAfter(pos);
        if (!next || next == last)
            return null;
        if (!next.type.isSkipped)
            return next.from < lineEnd ? openToken : null;
        pos = next.to;
    }
}
/**
An indentation strategy for delimited (usually bracketed) nodes.
Will, by default, indent one unit more than the parent's base
indent unless the line starts with a closing token. When `align`
is true and there are non-skipped nodes on the node's opening
line, the content of the node will be aligned with the end of the
opening node, like this:

    foo(bar,
        baz)
*/
function delimitedIndent({ closing, align = true, units = 1 }) {
    return (context) => delimitedStrategy(context, align, units, closing);
}
function delimitedStrategy(context, align, units, closing, closedAt) {
    let after = context.textAfter, space = after.match(/^\s*/)[0].length;
    let closed = closing && after.slice(space, space + closing.length) == closing || closedAt == context.pos + space;
    let aligned = align ? bracketedAligned(context) : null;
    if (aligned)
        return closed ? context.column(aligned.from) : context.column(aligned.to);
    return context.baseIndent + (closed ? 0 : context.unit * units);
}
/**
An indentation strategy that aligns a node's content to its base
indentation.
*/
const flatIndent = (context) => context.baseIndent;
/**
Creates an indentation strategy that, by default, indents
continued lines one unit more than the node's base indentation.
You can provide `except` to prevent indentation of lines that
match a pattern (for example `/^else\b/` in `if`/`else`
constructs), and you can change the amount of units used with the
`units` option.
*/
function continuedIndent({ except, units = 1 } = {}) {
    return (context) => {
        let matchExcept = except && except.test(context.textAfter);
        return context.baseIndent + (matchExcept ? 0 : units * context.unit);
    };
}
const DontIndentBeyond = 200;
/**
Enables reindentation on input. When a language defines an
`indentOnInput` field in its [language
data](https://codemirror.net/6/docs/ref/#state.EditorState.languageDataAt), which must hold a regular
expression, the line at the cursor will be reindented whenever new
text is typed and the input from the start of the line up to the
cursor matches that regexp.

To avoid unneccesary reindents, it is recommended to start the
regexp with `^` (usually followed by `\s*`), and end it with `$`.
For example, `/^\s*\}$/` will reindent when a closing brace is
added at the start of a line.
*/
function indentOnInput() {
    return EditorState.transactionFilter.of(tr => {
        if (!tr.docChanged || !tr.isUserEvent("input.type") && !tr.isUserEvent("input.complete"))
            return tr;
        let rules = tr.startState.languageDataAt("indentOnInput", tr.startState.selection.main.head);
        if (!rules.length)
            return tr;
        let doc = tr.newDoc, { head } = tr.newSelection.main, line = doc.lineAt(head);
        if (head > line.from + DontIndentBeyond)
            return tr;
        let lineStart = doc.sliceString(line.from, head);
        if (!rules.some(r => r.test(lineStart)))
            return tr;
        let { state } = tr, last = -1, changes = [];
        for (let { head } of state.selection.ranges) {
            let line = state.doc.lineAt(head);
            if (line.from == last)
                continue;
            last = line.from;
            let indent = getIndentation(state, line.from);
            if (indent == null)
                continue;
            let cur = /^\s*/.exec(line.text)[0];
            let norm = indentString(state, indent);
            if (cur != norm)
                changes.push({ from: line.from, to: line.from + cur.length, insert: norm });
        }
        return changes.length ? [tr, { changes, sequential: true }] : tr;
    });
}

/**
A facet that registers a code folding service. When called with
the extent of a line, such a function should return a foldable
range that starts on that line (but continues beyond it), if one
can be found.
*/
const foldService = /*@__PURE__*/Facet.define();
/**
This node prop is used to associate folding information with
syntax node types. Given a syntax node, it should check whether
that tree is foldable and return the range that can be collapsed
when it is.
*/
const foldNodeProp = /*@__PURE__*/new NodeProp();
/**
[Fold](https://codemirror.net/6/docs/ref/#language.foldNodeProp) function that folds everything but
the first and the last child of a syntax node. Useful for nodes
that start and end with delimiters.
*/
function foldInside(node) {
    let first = node.firstChild, last = node.lastChild;
    return first && first.to < last.from ? { from: first.to, to: last.type.isError ? node.to : last.from } : null;
}
function syntaxFolding(state, start, end) {
    let tree = syntaxTree(state);
    if (tree.length < end)
        return null;
    let stack = tree.resolveStack(end, 1);
    let found = null;
    for (let iter = stack; iter; iter = iter.next) {
        let cur = iter.node;
        if (cur.to <= end || cur.from > end)
            continue;
        if (found && cur.from < start)
            break;
        let prop = cur.type.prop(foldNodeProp);
        if (prop && (cur.to < tree.length - 50 || tree.length == state.doc.length || !isUnfinished(cur))) {
            let value = prop(cur, state);
            if (value && value.from <= end && value.from >= start && value.to > end)
                found = value;
        }
    }
    return found;
}
function isUnfinished(node) {
    let ch = node.lastChild;
    return ch && ch.to == node.to && ch.type.isError;
}
/**
Check whether the given line is foldable. First asks any fold
services registered through
[`foldService`](https://codemirror.net/6/docs/ref/#language.foldService), and if none of them return
a result, tries to query the [fold node
prop](https://codemirror.net/6/docs/ref/#language.foldNodeProp) of syntax nodes that cover the end
of the line.
*/
function foldable(state, lineStart, lineEnd) {
    for (let service of state.facet(foldService)) {
        let result = service(state, lineStart, lineEnd);
        if (result)
            return result;
    }
    return syntaxFolding(state, lineStart, lineEnd);
}
function mapRange(range, mapping) {
    let from = mapping.mapPos(range.from, 1), to = mapping.mapPos(range.to, -1);
    return from >= to ? undefined : { from, to };
}
/**
State effect that can be attached to a transaction to fold the
given range. (You probably only need this in exceptional
circumstances—usually you'll just want to let
[`foldCode`](https://codemirror.net/6/docs/ref/#language.foldCode) and the [fold
gutter](https://codemirror.net/6/docs/ref/#language.foldGutter) create the transactions.)
*/
const foldEffect = /*@__PURE__*/StateEffect.define({ map: mapRange });
/**
State effect that unfolds the given range (if it was folded).
*/
const unfoldEffect = /*@__PURE__*/StateEffect.define({ map: mapRange });
function selectedLines(view) {
    let lines = [];
    for (let { head } of view.state.selection.ranges) {
        if (lines.some(l => l.from <= head && l.to >= head))
            continue;
        lines.push(view.lineBlockAt(head));
    }
    return lines;
}
/**
The state field that stores the folded ranges (as a [decoration
set](https://codemirror.net/6/docs/ref/#view.DecorationSet)). Can be passed to
[`EditorState.toJSON`](https://codemirror.net/6/docs/ref/#state.EditorState.toJSON) and
[`fromJSON`](https://codemirror.net/6/docs/ref/#state.EditorState^fromJSON) to serialize the fold
state.
*/
const foldState = /*@__PURE__*/StateField.define({
    create() {
        return Decoration.none;
    },
    update(folded, tr) {
        folded = folded.map(tr.changes);
        for (let e of tr.effects) {
            if (e.is(foldEffect) && !foldExists(folded, e.value.from, e.value.to)) {
                let { preparePlaceholder } = tr.state.facet(foldConfig);
                let widget = !preparePlaceholder ? foldWidget :
                    Decoration.replace({ widget: new PreparedFoldWidget(preparePlaceholder(tr.state, e.value)) });
                folded = folded.update({ add: [widget.range(e.value.from, e.value.to)] });
            }
            else if (e.is(unfoldEffect)) {
                folded = folded.update({ filter: (from, to) => e.value.from != from || e.value.to != to,
                    filterFrom: e.value.from, filterTo: e.value.to });
            }
        }
        // Clear folded ranges that cover the selection head
        if (tr.selection) {
            let onSelection = false, { head } = tr.selection.main;
            folded.between(head, head, (a, b) => { if (a < head && b > head)
                onSelection = true; });
            if (onSelection)
                folded = folded.update({
                    filterFrom: head,
                    filterTo: head,
                    filter: (a, b) => b <= head || a >= head
                });
        }
        return folded;
    },
    provide: f => EditorView.decorations.from(f),
    toJSON(folded, state) {
        let ranges = [];
        folded.between(0, state.doc.length, (from, to) => { ranges.push(from, to); });
        return ranges;
    },
    fromJSON(value) {
        if (!Array.isArray(value) || value.length % 2)
            throw new RangeError("Invalid JSON for fold state");
        let ranges = [];
        for (let i = 0; i < value.length;) {
            let from = value[i++], to = value[i++];
            if (typeof from != "number" || typeof to != "number")
                throw new RangeError("Invalid JSON for fold state");
            ranges.push(foldWidget.range(from, to));
        }
        return Decoration.set(ranges, true);
    }
});
function findFold(state, from, to) {
    var _a;
    let found = null;
    (_a = state.field(foldState, false)) === null || _a === void 0 ? void 0 : _a.between(from, to, (from, to) => {
        if (!found || found.from > from)
            found = { from, to };
    });
    return found;
}
function foldExists(folded, from, to) {
    let found = false;
    folded.between(from, from, (a, b) => { if (a == from && b == to)
        found = true; });
    return found;
}
function maybeEnable(state, other) {
    return state.field(foldState, false) ? other : other.concat(StateEffect.appendConfig.of(codeFolding()));
}
/**
Fold the lines that are selected, if possible.
*/
const foldCode = view => {
    for (let line of selectedLines(view)) {
        let range = foldable(view.state, line.from, line.to);
        if (range) {
            view.dispatch({ effects: maybeEnable(view.state, [foldEffect.of(range), announceFold(view, range)]) });
            return true;
        }
    }
    return false;
};
/**
Unfold folded ranges on selected lines.
*/
const unfoldCode = view => {
    if (!view.state.field(foldState, false))
        return false;
    let effects = [];
    for (let line of selectedLines(view)) {
        let folded = findFold(view.state, line.from, line.to);
        if (folded)
            effects.push(unfoldEffect.of(folded), announceFold(view, folded, false));
    }
    if (effects.length)
        view.dispatch({ effects });
    return effects.length > 0;
};
function announceFold(view, range, fold = true) {
    let lineFrom = view.state.doc.lineAt(range.from).number, lineTo = view.state.doc.lineAt(range.to).number;
    return EditorView.announce.of(`${view.state.phrase(fold ? "Folded lines" : "Unfolded lines")} ${lineFrom} ${view.state.phrase("to")} ${lineTo}.`);
}
/**
Fold all top-level foldable ranges. Note that, in most cases,
folding information will depend on the [syntax
tree](https://codemirror.net/6/docs/ref/#language.syntaxTree), and folding everything may not work
reliably when the document hasn't been fully parsed (either
because the editor state was only just initialized, or because the
document is so big that the parser decided not to parse it
entirely).
*/
const foldAll = view => {
    let { state } = view, effects = [];
    for (let pos = 0; pos < state.doc.length;) {
        let line = view.lineBlockAt(pos), range = foldable(state, line.from, line.to);
        if (range)
            effects.push(foldEffect.of(range));
        pos = (range ? view.lineBlockAt(range.to) : line).to + 1;
    }
    if (effects.length)
        view.dispatch({ effects: maybeEnable(view.state, effects) });
    return !!effects.length;
};
/**
Unfold all folded code.
*/
const unfoldAll = view => {
    let field = view.state.field(foldState, false);
    if (!field || !field.size)
        return false;
    let effects = [];
    field.between(0, view.state.doc.length, (from, to) => { effects.push(unfoldEffect.of({ from, to })); });
    view.dispatch({ effects });
    return true;
};
/**
Default fold-related key bindings.

 - Ctrl-Shift-[ (Cmd-Alt-[ on macOS): [`foldCode`](https://codemirror.net/6/docs/ref/#language.foldCode).
 - Ctrl-Shift-] (Cmd-Alt-] on macOS): [`unfoldCode`](https://codemirror.net/6/docs/ref/#language.unfoldCode).
 - Ctrl-Alt-[: [`foldAll`](https://codemirror.net/6/docs/ref/#language.foldAll).
 - Ctrl-Alt-]: [`unfoldAll`](https://codemirror.net/6/docs/ref/#language.unfoldAll).
*/
const foldKeymap = [
    { key: "Ctrl-Shift-[", mac: "Cmd-Alt-[", run: foldCode },
    { key: "Ctrl-Shift-]", mac: "Cmd-Alt-]", run: unfoldCode },
    { key: "Ctrl-Alt-[", run: foldAll },
    { key: "Ctrl-Alt-]", run: unfoldAll }
];
const defaultConfig = {
    placeholderDOM: null,
    preparePlaceholder: null,
    placeholderText: "…"
};
const foldConfig = /*@__PURE__*/Facet.define({
    combine(values) { return combineConfig(values, defaultConfig); }
});
/**
Create an extension that configures code folding.
*/
function codeFolding(config) {
    let result = [foldState, baseTheme$1];
    return result;
}
function widgetToDOM(view, prepared) {
    let { state } = view, conf = state.facet(foldConfig);
    let onclick = (event) => {
        let line = view.lineBlockAt(view.posAtDOM(event.target));
        let folded = findFold(view.state, line.from, line.to);
        if (folded)
            view.dispatch({ effects: unfoldEffect.of(folded) });
        event.preventDefault();
    };
    if (conf.placeholderDOM)
        return conf.placeholderDOM(view, onclick, prepared);
    let element = document.createElement("span");
    element.textContent = conf.placeholderText;
    element.setAttribute("aria-label", state.phrase("folded code"));
    element.title = state.phrase("unfold");
    element.className = "cm-foldPlaceholder";
    element.onclick = onclick;
    return element;
}
const foldWidget = /*@__PURE__*/Decoration.replace({ widget: /*@__PURE__*/new class extends WidgetType {
        toDOM(view) { return widgetToDOM(view, null); }
    } });
class PreparedFoldWidget extends WidgetType {
    constructor(value) {
        super();
        this.value = value;
    }
    eq(other) { return this.value == other.value; }
    toDOM(view) { return widgetToDOM(view, this.value); }
}
const foldGutterDefaults = {
    openText: "⌄",
    closedText: "›",
    markerDOM: null,
    domEventHandlers: {},
    foldingChanged: () => false
};
class FoldMarker extends GutterMarker {
    constructor(config, open) {
        super();
        this.config = config;
        this.open = open;
    }
    eq(other) { return this.config == other.config && this.open == other.open; }
    toDOM(view) {
        if (this.config.markerDOM)
            return this.config.markerDOM(this.open);
        let span = document.createElement("span");
        span.textContent = this.open ? this.config.openText : this.config.closedText;
        span.title = view.state.phrase(this.open ? "Fold line" : "Unfold line");
        return span;
    }
}
/**
Create an extension that registers a fold gutter, which shows a
fold status indicator before foldable lines (which can be clicked
to fold or unfold the line).
*/
function foldGutter(config = {}) {
    let fullConfig = Object.assign(Object.assign({}, foldGutterDefaults), config);
    let canFold = new FoldMarker(fullConfig, true), canUnfold = new FoldMarker(fullConfig, false);
    let markers = ViewPlugin.fromClass(class {
        constructor(view) {
            this.from = view.viewport.from;
            this.markers = this.buildMarkers(view);
        }
        update(update) {
            if (update.docChanged || update.viewportChanged ||
                update.startState.facet(language) != update.state.facet(language) ||
                update.startState.field(foldState, false) != update.state.field(foldState, false) ||
                syntaxTree(update.startState) != syntaxTree(update.state) ||
                fullConfig.foldingChanged(update))
                this.markers = this.buildMarkers(update.view);
        }
        buildMarkers(view) {
            let builder = new RangeSetBuilder();
            for (let line of view.viewportLineBlocks) {
                let mark = findFold(view.state, line.from, line.to) ? canUnfold
                    : foldable(view.state, line.from, line.to) ? canFold : null;
                if (mark)
                    builder.add(line.from, line.from, mark);
            }
            return builder.finish();
        }
    });
    let { domEventHandlers } = fullConfig;
    return [
        markers,
        gutter({
            class: "cm-foldGutter",
            markers(view) { var _a; return ((_a = view.plugin(markers)) === null || _a === void 0 ? void 0 : _a.markers) || RangeSet.empty; },
            initialSpacer() {
                return new FoldMarker(fullConfig, false);
            },
            domEventHandlers: Object.assign(Object.assign({}, domEventHandlers), { click: (view, line, event) => {
                    if (domEventHandlers.click && domEventHandlers.click(view, line, event))
                        return true;
                    let folded = findFold(view.state, line.from, line.to);
                    if (folded) {
                        view.dispatch({ effects: unfoldEffect.of(folded) });
                        return true;
                    }
                    let range = foldable(view.state, line.from, line.to);
                    if (range) {
                        view.dispatch({ effects: foldEffect.of(range) });
                        return true;
                    }
                    return false;
                } })
        }),
        codeFolding()
    ];
}
const baseTheme$1 = /*@__PURE__*/EditorView.baseTheme({
    ".cm-foldPlaceholder": {
        backgroundColor: "#eee",
        border: "1px solid #ddd",
        color: "#888",
        borderRadius: ".2em",
        margin: "0 1px",
        padding: "0 1px",
        cursor: "pointer"
    },
    ".cm-foldGutter span": {
        padding: "0 1px",
        cursor: "pointer"
    }
});

/**
A highlight style associates CSS styles with higlighting
[tags](https://lezer.codemirror.net/docs/ref#highlight.Tag).
*/
class HighlightStyle {
    constructor(
    /**
    The tag styles used to create this highlight style.
    */
    specs, options) {
        this.specs = specs;
        let modSpec;
        function def(spec) {
            let cls = StyleModule.newName();
            (modSpec || (modSpec = Object.create(null)))["." + cls] = spec;
            return cls;
        }
        const all = typeof options.all == "string" ? options.all : options.all ? def(options.all) : undefined;
        const scopeOpt = options.scope;
        this.scope = scopeOpt instanceof Language ? (type) => type.prop(languageDataProp) == scopeOpt.data
            : scopeOpt ? (type) => type == scopeOpt : undefined;
        this.style = tagHighlighter(specs.map(style => ({
            tag: style.tag,
            class: style.class || def(Object.assign({}, style, { tag: null }))
        })), {
            all,
        }).style;
        this.module = modSpec ? new StyleModule(modSpec) : null;
        this.themeType = options.themeType;
    }
    /**
    Create a highlighter style that associates the given styles to
    the given tags. The specs must be objects that hold a style tag
    or array of tags in their `tag` property, and either a single
    `class` property providing a static CSS class (for highlighter
    that rely on external styling), or a
    [`style-mod`](https://github.com/marijnh/style-mod#documentation)-style
    set of CSS properties (which define the styling for those tags).
    
    The CSS rules created for a highlighter will be emitted in the
    order of the spec's properties. That means that for elements that
    have multiple tags associated with them, styles defined further
    down in the list will have a higher CSS precedence than styles
    defined earlier.
    */
    static define(specs, options) {
        return new HighlightStyle(specs, options || {});
    }
}
const highlighterFacet = /*@__PURE__*/Facet.define();
const fallbackHighlighter = /*@__PURE__*/Facet.define({
    combine(values) { return values.length ? [values[0]] : null; }
});
function getHighlighters(state) {
    let main = state.facet(highlighterFacet);
    return main.length ? main : state.facet(fallbackHighlighter);
}
/**
Wrap a highlighter in an editor extension that uses it to apply
syntax highlighting to the editor content.

When multiple (non-fallback) styles are provided, the styling
applied is the union of the classes they emit.
*/
function syntaxHighlighting(highlighter, options) {
    let ext = [treeHighlighter], themeType;
    if (highlighter instanceof HighlightStyle) {
        if (highlighter.module)
            ext.push(EditorView.styleModule.of(highlighter.module));
        themeType = highlighter.themeType;
    }
    if (options === null || options === void 0 ? void 0 : options.fallback)
        ext.push(fallbackHighlighter.of(highlighter));
    else if (themeType)
        ext.push(highlighterFacet.computeN([EditorView.darkTheme], state => {
            return state.facet(EditorView.darkTheme) == (themeType == "dark") ? [highlighter] : [];
        }));
    else
        ext.push(highlighterFacet.of(highlighter));
    return ext;
}
class TreeHighlighter {
    constructor(view) {
        this.markCache = Object.create(null);
        this.tree = syntaxTree(view.state);
        this.decorations = this.buildDeco(view, getHighlighters(view.state));
        this.decoratedTo = view.viewport.to;
    }
    update(update) {
        let tree = syntaxTree(update.state), highlighters = getHighlighters(update.state);
        let styleChange = highlighters != getHighlighters(update.startState);
        let { viewport } = update.view, decoratedToMapped = update.changes.mapPos(this.decoratedTo, 1);
        if (tree.length < viewport.to && !styleChange && tree.type == this.tree.type && decoratedToMapped >= viewport.to) {
            this.decorations = this.decorations.map(update.changes);
            this.decoratedTo = decoratedToMapped;
        }
        else if (tree != this.tree || update.viewportChanged || styleChange) {
            this.tree = tree;
            this.decorations = this.buildDeco(update.view, highlighters);
            this.decoratedTo = viewport.to;
        }
    }
    buildDeco(view, highlighters) {
        if (!highlighters || !this.tree.length)
            return Decoration.none;
        let builder = new RangeSetBuilder();
        for (let { from, to } of view.visibleRanges) {
            highlightTree(this.tree, highlighters, (from, to, style) => {
                builder.add(from, to, this.markCache[style] || (this.markCache[style] = Decoration.mark({ class: style })));
            }, from, to);
        }
        return builder.finish();
    }
}
const treeHighlighter = /*@__PURE__*/Prec.high(/*@__PURE__*/ViewPlugin.fromClass(TreeHighlighter, {
    decorations: v => v.decorations
}));
/**
A default highlight style (works well with light themes).
*/
const defaultHighlightStyle = /*@__PURE__*/HighlightStyle.define([
    { tag: tags.meta,
        color: "#404740" },
    { tag: tags.link,
        textDecoration: "underline" },
    { tag: tags.heading,
        textDecoration: "underline",
        fontWeight: "bold" },
    { tag: tags.emphasis,
        fontStyle: "italic" },
    { tag: tags.strong,
        fontWeight: "bold" },
    { tag: tags.strikethrough,
        textDecoration: "line-through" },
    { tag: tags.keyword,
        color: "#708" },
    { tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName],
        color: "#219" },
    { tag: [tags.literal, tags.inserted],
        color: "#164" },
    { tag: [tags.string, tags.deleted],
        color: "#a11" },
    { tag: [tags.regexp, tags.escape, /*@__PURE__*/tags.special(tags.string)],
        color: "#e40" },
    { tag: /*@__PURE__*/tags.definition(tags.variableName),
        color: "#00f" },
    { tag: /*@__PURE__*/tags.local(tags.variableName),
        color: "#30a" },
    { tag: [tags.typeName, tags.namespace],
        color: "#085" },
    { tag: tags.className,
        color: "#167" },
    { tag: [/*@__PURE__*/tags.special(tags.variableName), tags.macroName],
        color: "#256" },
    { tag: /*@__PURE__*/tags.definition(tags.propertyName),
        color: "#00c" },
    { tag: tags.comment,
        color: "#940" },
    { tag: tags.invalid,
        color: "#f00" }
]);

const baseTheme$2 = /*@__PURE__*/EditorView.baseTheme({
    "&.cm-focused .cm-matchingBracket": { backgroundColor: "#328c8252" },
    "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "#bb555544" }
});
const DefaultScanDist = 10000, DefaultBrackets = "()[]{}";
const bracketMatchingConfig = /*@__PURE__*/Facet.define({
    combine(configs) {
        return combineConfig(configs, {
            afterCursor: true,
            brackets: DefaultBrackets,
            maxScanDistance: DefaultScanDist,
            renderMatch: defaultRenderMatch
        });
    }
});
const matchingMark = /*@__PURE__*/Decoration.mark({ class: "cm-matchingBracket" }), nonmatchingMark = /*@__PURE__*/Decoration.mark({ class: "cm-nonmatchingBracket" });
function defaultRenderMatch(match) {
    let decorations = [];
    let mark = match.matched ? matchingMark : nonmatchingMark;
    decorations.push(mark.range(match.start.from, match.start.to));
    if (match.end)
        decorations.push(mark.range(match.end.from, match.end.to));
    return decorations;
}
const bracketMatchingState = /*@__PURE__*/StateField.define({
    create() { return Decoration.none; },
    update(deco, tr) {
        if (!tr.docChanged && !tr.selection)
            return deco;
        let decorations = [];
        let config = tr.state.facet(bracketMatchingConfig);
        for (let range of tr.state.selection.ranges) {
            if (!range.empty)
                continue;
            let match = matchBrackets(tr.state, range.head, -1, config)
                || (range.head > 0 && matchBrackets(tr.state, range.head - 1, 1, config))
                || (config.afterCursor &&
                    (matchBrackets(tr.state, range.head, 1, config) ||
                        (range.head < tr.state.doc.length && matchBrackets(tr.state, range.head + 1, -1, config))));
            if (match)
                decorations = decorations.concat(config.renderMatch(match, tr.state));
        }
        return Decoration.set(decorations, true);
    },
    provide: f => EditorView.decorations.from(f)
});
const bracketMatchingUnique = [
    bracketMatchingState,
    baseTheme$2
];
/**
Create an extension that enables bracket matching. Whenever the
cursor is next to a bracket, that bracket and the one it matches
are highlighted. Or, when no matching bracket is found, another
highlighting style is used to indicate this.
*/
function bracketMatching(config = {}) {
    return [bracketMatchingConfig.of(config), bracketMatchingUnique];
}
/**
When larger syntax nodes, such as HTML tags, are marked as
opening/closing, it can be a bit messy to treat the whole node as
a matchable bracket. This node prop allows you to define, for such
a node, a ‘handle’—the part of the node that is highlighted, and
that the cursor must be on to activate highlighting in the first
place.
*/
const bracketMatchingHandle = /*@__PURE__*/new NodeProp();
function matchingNodes(node, dir, brackets) {
    let byProp = node.prop(dir < 0 ? NodeProp.openedBy : NodeProp.closedBy);
    if (byProp)
        return byProp;
    if (node.name.length == 1) {
        let index = brackets.indexOf(node.name);
        if (index > -1 && index % 2 == (dir < 0 ? 1 : 0))
            return [brackets[index + dir]];
    }
    return null;
}
function findHandle(node) {
    let hasHandle = node.type.prop(bracketMatchingHandle);
    return hasHandle ? hasHandle(node.node) : node;
}
/**
Find the matching bracket for the token at `pos`, scanning
direction `dir`. Only the `brackets` and `maxScanDistance`
properties are used from `config`, if given. Returns null if no
bracket was found at `pos`, or a match result otherwise.
*/
function matchBrackets(state, pos, dir, config = {}) {
    let maxScanDistance = config.maxScanDistance || DefaultScanDist, brackets = config.brackets || DefaultBrackets;
    let tree = syntaxTree(state), node = tree.resolveInner(pos, dir);
    for (let cur = node; cur; cur = cur.parent) {
        let matches = matchingNodes(cur.type, dir, brackets);
        if (matches && cur.from < cur.to) {
            let handle = findHandle(cur);
            if (handle && (dir > 0 ? pos >= handle.from && pos < handle.to : pos > handle.from && pos <= handle.to))
                return matchMarkedBrackets(state, pos, dir, cur, handle, matches, brackets);
        }
    }
    return matchPlainBrackets(state, pos, dir, tree, node.type, maxScanDistance, brackets);
}
function matchMarkedBrackets(_state, _pos, dir, token, handle, matching, brackets) {
    let parent = token.parent, firstToken = { from: handle.from, to: handle.to };
    let depth = 0, cursor = parent === null || parent === void 0 ? void 0 : parent.cursor();
    if (cursor && (dir < 0 ? cursor.childBefore(token.from) : cursor.childAfter(token.to)))
        do {
            if (dir < 0 ? cursor.to <= token.from : cursor.from >= token.to) {
                if (depth == 0 && matching.indexOf(cursor.type.name) > -1 && cursor.from < cursor.to) {
                    let endHandle = findHandle(cursor);
                    return { start: firstToken, end: endHandle ? { from: endHandle.from, to: endHandle.to } : undefined, matched: true };
                }
                else if (matchingNodes(cursor.type, dir, brackets)) {
                    depth++;
                }
                else if (matchingNodes(cursor.type, -dir, brackets)) {
                    if (depth == 0) {
                        let endHandle = findHandle(cursor);
                        return {
                            start: firstToken,
                            end: endHandle && endHandle.from < endHandle.to ? { from: endHandle.from, to: endHandle.to } : undefined,
                            matched: false
                        };
                    }
                    depth--;
                }
            }
        } while (dir < 0 ? cursor.prevSibling() : cursor.nextSibling());
    return { start: firstToken, matched: false };
}
function matchPlainBrackets(state, pos, dir, tree, tokenType, maxScanDistance, brackets) {
    let startCh = dir < 0 ? state.sliceDoc(pos - 1, pos) : state.sliceDoc(pos, pos + 1);
    let bracket = brackets.indexOf(startCh);
    if (bracket < 0 || (bracket % 2 == 0) != (dir > 0))
        return null;
    let startToken = { from: dir < 0 ? pos - 1 : pos, to: dir > 0 ? pos + 1 : pos };
    let iter = state.doc.iterRange(pos, dir > 0 ? state.doc.length : 0), depth = 0;
    for (let distance = 0; !(iter.next()).done && distance <= maxScanDistance;) {
        let text = iter.value;
        if (dir < 0)
            distance += text.length;
        let basePos = pos + distance * dir;
        for (let pos = dir > 0 ? 0 : text.length - 1, end = dir > 0 ? text.length : -1; pos != end; pos += dir) {
            let found = brackets.indexOf(text[pos]);
            if (found < 0 || tree.resolveInner(basePos + pos, 1).type != tokenType)
                continue;
            if ((found % 2 == 0) == (dir > 0)) {
                depth++;
            }
            else if (depth == 1) { // Closing
                return { start: startToken, end: { from: basePos + pos, to: basePos + pos + 1 }, matched: (found >> 1) == (bracket >> 1) };
            }
            else {
                depth--;
            }
        }
        if (dir > 0)
            distance += text.length;
    }
    return iter.done ? { start: startToken, matched: false } : null;
}
const noTokens = /*@__PURE__*/Object.create(null);
const typeArray = [NodeType.none];
const warned = [];
// Cache of node types by name and tags
const byTag = /*@__PURE__*/Object.create(null);
const defaultTable = /*@__PURE__*/Object.create(null);
for (let [legacyName, name] of [
    ["variable", "variableName"],
    ["variable-2", "variableName.special"],
    ["string-2", "string.special"],
    ["def", "variableName.definition"],
    ["tag", "tagName"],
    ["attribute", "attributeName"],
    ["type", "typeName"],
    ["builtin", "variableName.standard"],
    ["qualifier", "modifier"],
    ["error", "invalid"],
    ["header", "heading"],
    ["property", "propertyName"]
])
    defaultTable[legacyName] = /*@__PURE__*/createTokenType(noTokens, name);
function warnForPart(part, msg) {
    if (warned.indexOf(part) > -1)
        return;
    warned.push(part);
    console.warn(msg);
}
function createTokenType(extra, tagStr) {
    let tags$1 = [];
    for (let name of tagStr.split(" ")) {
        let found = [];
        for (let part of name.split(".")) {
            let value = (extra[part] || tags[part]);
            if (!value) {
                warnForPart(part, `Unknown highlighting tag ${part}`);
            }
            else if (typeof value == "function") {
                if (!found.length)
                    warnForPart(part, `Modifier ${part} used at start of tag`);
                else
                    found = found.map(value);
            }
            else {
                if (found.length)
                    warnForPart(part, `Tag ${part} used as modifier`);
                else
                    found = Array.isArray(value) ? value : [value];
            }
        }
        for (let tag of found)
            tags$1.push(tag);
    }
    if (!tags$1.length)
        return 0;
    let name = tagStr.replace(/ /g, "_"), key = name + " " + tags$1.map(t => t.id);
    let known = byTag[key];
    if (known)
        return known.id;
    let type = byTag[key] = NodeType.define({
        id: typeArray.length,
        name,
        props: [styleTags({ [name]: tags$1 })]
    });
    typeArray.push(type);
    return type.id;
}
({
    rtl: /*@__PURE__*/Decoration.mark({ class: "cm-iso", inclusive: true, attributes: { dir: "rtl" }, bidiIsolate: Direction.RTL }),
    ltr: /*@__PURE__*/Decoration.mark({ class: "cm-iso", inclusive: true, attributes: { dir: "ltr" }, bidiIsolate: Direction.LTR }),
    auto: /*@__PURE__*/Decoration.mark({ class: "cm-iso", inclusive: true, attributes: { dir: "auto" }, bidiIsolate: null })
});

/**
Comment or uncomment the current selection. Will use line comments
if available, otherwise falling back to block comments.
*/
const toggleComment = target => {
    let { state } = target, line = state.doc.lineAt(state.selection.main.from), config = getConfig(target.state, line.from);
    return config.line ? toggleLineComment(target) : config.block ? toggleBlockCommentByLine(target) : false;
};
function command(f, option) {
    return ({ state, dispatch }) => {
        if (state.readOnly)
            return false;
        let tr = f(option, state);
        if (!tr)
            return false;
        dispatch(state.update(tr));
        return true;
    };
}
/**
Comment or uncomment the current selection using line comments.
The line comment syntax is taken from the
[`commentTokens`](https://codemirror.net/6/docs/ref/#commands.CommentTokens) [language
data](https://codemirror.net/6/docs/ref/#state.EditorState.languageDataAt).
*/
const toggleLineComment = /*@__PURE__*/command(changeLineComment, 0 /* CommentOption.Toggle */);
/**
Comment or uncomment the current selection using block comments.
The block comment syntax is taken from the
[`commentTokens`](https://codemirror.net/6/docs/ref/#commands.CommentTokens) [language
data](https://codemirror.net/6/docs/ref/#state.EditorState.languageDataAt).
*/
const toggleBlockComment = /*@__PURE__*/command(changeBlockComment, 0 /* CommentOption.Toggle */);
/**
Comment or uncomment the lines around the current selection using
block comments.
*/
const toggleBlockCommentByLine = /*@__PURE__*/command((o, s) => changeBlockComment(o, s, selectedLineRanges(s)), 0 /* CommentOption.Toggle */);
function getConfig(state, pos) {
    let data = state.languageDataAt("commentTokens", pos);
    return data.length ? data[0] : {};
}
const SearchMargin = 50;
/**
Determines if the given range is block-commented in the given
state.
*/
function findBlockComment(state, { open, close }, from, to) {
    let textBefore = state.sliceDoc(from - SearchMargin, from);
    let textAfter = state.sliceDoc(to, to + SearchMargin);
    let spaceBefore = /\s*$/.exec(textBefore)[0].length, spaceAfter = /^\s*/.exec(textAfter)[0].length;
    let beforeOff = textBefore.length - spaceBefore;
    if (textBefore.slice(beforeOff - open.length, beforeOff) == open &&
        textAfter.slice(spaceAfter, spaceAfter + close.length) == close) {
        return { open: { pos: from - spaceBefore, margin: spaceBefore && 1 },
            close: { pos: to + spaceAfter, margin: spaceAfter && 1 } };
    }
    let startText, endText;
    if (to - from <= 2 * SearchMargin) {
        startText = endText = state.sliceDoc(from, to);
    }
    else {
        startText = state.sliceDoc(from, from + SearchMargin);
        endText = state.sliceDoc(to - SearchMargin, to);
    }
    let startSpace = /^\s*/.exec(startText)[0].length, endSpace = /\s*$/.exec(endText)[0].length;
    let endOff = endText.length - endSpace - close.length;
    if (startText.slice(startSpace, startSpace + open.length) == open &&
        endText.slice(endOff, endOff + close.length) == close) {
        return { open: { pos: from + startSpace + open.length,
                margin: /\s/.test(startText.charAt(startSpace + open.length)) ? 1 : 0 },
            close: { pos: to - endSpace - close.length,
                margin: /\s/.test(endText.charAt(endOff - 1)) ? 1 : 0 } };
    }
    return null;
}
function selectedLineRanges(state) {
    let ranges = [];
    for (let r of state.selection.ranges) {
        let fromLine = state.doc.lineAt(r.from);
        let toLine = r.to <= fromLine.to ? fromLine : state.doc.lineAt(r.to);
        let last = ranges.length - 1;
        if (last >= 0 && ranges[last].to > fromLine.from)
            ranges[last].to = toLine.to;
        else
            ranges.push({ from: fromLine.from + /^\s*/.exec(fromLine.text)[0].length, to: toLine.to });
    }
    return ranges;
}
// Performs toggle, comment and uncomment of block comments in
// languages that support them.
function changeBlockComment(option, state, ranges = state.selection.ranges) {
    let tokens = ranges.map(r => getConfig(state, r.from).block);
    if (!tokens.every(c => c))
        return null;
    let comments = ranges.map((r, i) => findBlockComment(state, tokens[i], r.from, r.to));
    if (option != 2 /* CommentOption.Uncomment */ && !comments.every(c => c)) {
        return { changes: state.changes(ranges.map((range, i) => {
                if (comments[i])
                    return [];
                return [{ from: range.from, insert: tokens[i].open + " " }, { from: range.to, insert: " " + tokens[i].close }];
            })) };
    }
    else if (option != 1 /* CommentOption.Comment */ && comments.some(c => c)) {
        let changes = [];
        for (let i = 0, comment; i < comments.length; i++)
            if (comment = comments[i]) {
                let token = tokens[i], { open, close } = comment;
                changes.push({ from: open.pos - token.open.length, to: open.pos + open.margin }, { from: close.pos - close.margin, to: close.pos + token.close.length });
            }
        return { changes };
    }
    return null;
}
// Performs toggle, comment and uncomment of line comments.
function changeLineComment(option, state, ranges = state.selection.ranges) {
    let lines = [];
    let prevLine = -1;
    for (let { from, to } of ranges) {
        let startI = lines.length, minIndent = 1e9;
        let token = getConfig(state, from).line;
        if (!token)
            continue;
        for (let pos = from; pos <= to;) {
            let line = state.doc.lineAt(pos);
            if (line.from > prevLine && (from == to || to > line.from)) {
                prevLine = line.from;
                let indent = /^\s*/.exec(line.text)[0].length;
                let empty = indent == line.length;
                let comment = line.text.slice(indent, indent + token.length) == token ? indent : -1;
                if (indent < line.text.length && indent < minIndent)
                    minIndent = indent;
                lines.push({ line, comment, token, indent, empty, single: false });
            }
            pos = line.to + 1;
        }
        if (minIndent < 1e9)
            for (let i = startI; i < lines.length; i++)
                if (lines[i].indent < lines[i].line.text.length)
                    lines[i].indent = minIndent;
        if (lines.length == startI + 1)
            lines[startI].single = true;
    }
    if (option != 2 /* CommentOption.Uncomment */ && lines.some(l => l.comment < 0 && (!l.empty || l.single))) {
        let changes = [];
        for (let { line, token, indent, empty, single } of lines)
            if (single || !empty)
                changes.push({ from: line.from + indent, insert: token + " " });
        let changeSet = state.changes(changes);
        return { changes: changeSet, selection: state.selection.map(changeSet, 1) };
    }
    else if (option != 1 /* CommentOption.Comment */ && lines.some(l => l.comment >= 0)) {
        let changes = [];
        for (let { line, comment, token } of lines)
            if (comment >= 0) {
                let from = line.from + comment, to = from + token.length;
                if (line.text[to - line.from] == " ")
                    to++;
                changes.push({ from, to });
            }
        return { changes };
    }
    return null;
}

const fromHistory = /*@__PURE__*/Annotation.define();
/**
Transaction annotation that will prevent that transaction from
being combined with other transactions in the undo history. Given
`"before"`, it'll prevent merging with previous transactions. With
`"after"`, subsequent transactions won't be combined with this
one. With `"full"`, the transaction is isolated on both sides.
*/
const isolateHistory = /*@__PURE__*/Annotation.define();
/**
This facet provides a way to register functions that, given a
transaction, provide a set of effects that the history should
store when inverting the transaction. This can be used to
integrate some kinds of effects in the history, so that they can
be undone (and redone again).
*/
const invertedEffects = /*@__PURE__*/Facet.define();
const historyConfig = /*@__PURE__*/Facet.define({
    combine(configs) {
        return combineConfig(configs, {
            minDepth: 100,
            newGroupDelay: 500,
            joinToEvent: (_t, isAdjacent) => isAdjacent,
        }, {
            minDepth: Math.max,
            newGroupDelay: Math.min,
            joinToEvent: (a, b) => (tr, adj) => a(tr, adj) || b(tr, adj)
        });
    }
});
const historyField_ = /*@__PURE__*/StateField.define({
    create() {
        return HistoryState.empty;
    },
    update(state, tr) {
        let config = tr.state.facet(historyConfig);
        let fromHist = tr.annotation(fromHistory);
        if (fromHist) {
            let item = HistEvent.fromTransaction(tr, fromHist.selection), from = fromHist.side;
            let other = from == 0 /* BranchName.Done */ ? state.undone : state.done;
            if (item)
                other = updateBranch(other, other.length, config.minDepth, item);
            else
                other = addSelection(other, tr.startState.selection);
            return new HistoryState(from == 0 /* BranchName.Done */ ? fromHist.rest : other, from == 0 /* BranchName.Done */ ? other : fromHist.rest);
        }
        let isolate = tr.annotation(isolateHistory);
        if (isolate == "full" || isolate == "before")
            state = state.isolate();
        if (tr.annotation(Transaction.addToHistory) === false)
            return !tr.changes.empty ? state.addMapping(tr.changes.desc) : state;
        let event = HistEvent.fromTransaction(tr);
        let time = tr.annotation(Transaction.time), userEvent = tr.annotation(Transaction.userEvent);
        if (event)
            state = state.addChanges(event, time, userEvent, config, tr);
        else if (tr.selection)
            state = state.addSelection(tr.startState.selection, time, userEvent, config.newGroupDelay);
        if (isolate == "full" || isolate == "after")
            state = state.isolate();
        return state;
    },
    toJSON(value) {
        return { done: value.done.map(e => e.toJSON()), undone: value.undone.map(e => e.toJSON()) };
    },
    fromJSON(json) {
        return new HistoryState(json.done.map(HistEvent.fromJSON), json.undone.map(HistEvent.fromJSON));
    }
});
/**
Create a history extension with the given configuration.
*/
function history(config = {}) {
    return [
        historyField_,
        historyConfig.of(config),
        EditorView.domEventHandlers({
            beforeinput(e, view) {
                let command = e.inputType == "historyUndo" ? undo : e.inputType == "historyRedo" ? redo : null;
                if (!command)
                    return false;
                e.preventDefault();
                return command(view);
            }
        })
    ];
}
function cmd(side, selection) {
    return function ({ state, dispatch }) {
        if (!selection && state.readOnly)
            return false;
        let historyState = state.field(historyField_, false);
        if (!historyState)
            return false;
        let tr = historyState.pop(side, state, selection);
        if (!tr)
            return false;
        dispatch(tr);
        return true;
    };
}
/**
Undo a single group of history events. Returns false if no group
was available.
*/
const undo = /*@__PURE__*/cmd(0 /* BranchName.Done */, false);
/**
Redo a group of history events. Returns false if no group was
available.
*/
const redo = /*@__PURE__*/cmd(1 /* BranchName.Undone */, false);
/**
Undo a change or selection change.
*/
const undoSelection = /*@__PURE__*/cmd(0 /* BranchName.Done */, true);
/**
Redo a change or selection change.
*/
const redoSelection = /*@__PURE__*/cmd(1 /* BranchName.Undone */, true);
// History events store groups of changes or effects that need to be
// undone/redone together.
class HistEvent {
    constructor(
    // The changes in this event. Normal events hold at least one
    // change or effect. But it may be necessary to store selection
    // events before the first change, in which case a special type of
    // instance is created which doesn't hold any changes, with
    // changes == startSelection == undefined
    changes, 
    // The effects associated with this event
    effects, 
    // Accumulated mapping (from addToHistory==false) that should be
    // applied to events below this one.
    mapped, 
    // The selection before this event
    startSelection, 
    // Stores selection changes after this event, to be used for
    // selection undo/redo.
    selectionsAfter) {
        this.changes = changes;
        this.effects = effects;
        this.mapped = mapped;
        this.startSelection = startSelection;
        this.selectionsAfter = selectionsAfter;
    }
    setSelAfter(after) {
        return new HistEvent(this.changes, this.effects, this.mapped, this.startSelection, after);
    }
    toJSON() {
        var _a, _b, _c;
        return {
            changes: (_a = this.changes) === null || _a === void 0 ? void 0 : _a.toJSON(),
            mapped: (_b = this.mapped) === null || _b === void 0 ? void 0 : _b.toJSON(),
            startSelection: (_c = this.startSelection) === null || _c === void 0 ? void 0 : _c.toJSON(),
            selectionsAfter: this.selectionsAfter.map(s => s.toJSON())
        };
    }
    static fromJSON(json) {
        return new HistEvent(json.changes && ChangeSet.fromJSON(json.changes), [], json.mapped && ChangeDesc.fromJSON(json.mapped), json.startSelection && EditorSelection.fromJSON(json.startSelection), json.selectionsAfter.map(EditorSelection.fromJSON));
    }
    // This does not check `addToHistory` and such, it assumes the
    // transaction needs to be converted to an item. Returns null when
    // there are no changes or effects in the transaction.
    static fromTransaction(tr, selection) {
        let effects = none;
        for (let invert of tr.startState.facet(invertedEffects)) {
            let result = invert(tr);
            if (result.length)
                effects = effects.concat(result);
        }
        if (!effects.length && tr.changes.empty)
            return null;
        return new HistEvent(tr.changes.invert(tr.startState.doc), effects, undefined, selection || tr.startState.selection, none);
    }
    static selection(selections) {
        return new HistEvent(undefined, none, undefined, undefined, selections);
    }
}
function updateBranch(branch, to, maxLen, newEvent) {
    let start = to + 1 > maxLen + 20 ? to - maxLen - 1 : 0;
    let newBranch = branch.slice(start, to);
    newBranch.push(newEvent);
    return newBranch;
}
function isAdjacent(a, b) {
    let ranges = [], isAdjacent = false;
    a.iterChangedRanges((f, t) => ranges.push(f, t));
    b.iterChangedRanges((_f, _t, f, t) => {
        for (let i = 0; i < ranges.length;) {
            let from = ranges[i++], to = ranges[i++];
            if (t >= from && f <= to)
                isAdjacent = true;
        }
    });
    return isAdjacent;
}
function eqSelectionShape(a, b) {
    return a.ranges.length == b.ranges.length &&
        a.ranges.filter((r, i) => r.empty != b.ranges[i].empty).length === 0;
}
function conc(a, b) {
    return !a.length ? b : !b.length ? a : a.concat(b);
}
const none = [];
const MaxSelectionsPerEvent = 200;
function addSelection(branch, selection) {
    if (!branch.length) {
        return [HistEvent.selection([selection])];
    }
    else {
        let lastEvent = branch[branch.length - 1];
        let sels = lastEvent.selectionsAfter.slice(Math.max(0, lastEvent.selectionsAfter.length - MaxSelectionsPerEvent));
        if (sels.length && sels[sels.length - 1].eq(selection))
            return branch;
        sels.push(selection);
        return updateBranch(branch, branch.length - 1, 1e9, lastEvent.setSelAfter(sels));
    }
}
// Assumes the top item has one or more selectionAfter values
function popSelection(branch) {
    let last = branch[branch.length - 1];
    let newBranch = branch.slice();
    newBranch[branch.length - 1] = last.setSelAfter(last.selectionsAfter.slice(0, last.selectionsAfter.length - 1));
    return newBranch;
}
// Add a mapping to the top event in the given branch. If this maps
// away all the changes and effects in that item, drop it and
// propagate the mapping to the next item.
function addMappingToBranch(branch, mapping) {
    if (!branch.length)
        return branch;
    let length = branch.length, selections = none;
    while (length) {
        let event = mapEvent(branch[length - 1], mapping, selections);
        if (event.changes && !event.changes.empty || event.effects.length) { // Event survived mapping
            let result = branch.slice(0, length);
            result[length - 1] = event;
            return result;
        }
        else { // Drop this event, since there's no changes or effects left
            mapping = event.mapped;
            length--;
            selections = event.selectionsAfter;
        }
    }
    return selections.length ? [HistEvent.selection(selections)] : none;
}
function mapEvent(event, mapping, extraSelections) {
    let selections = conc(event.selectionsAfter.length ? event.selectionsAfter.map(s => s.map(mapping)) : none, extraSelections);
    // Change-less events don't store mappings (they are always the last event in a branch)
    if (!event.changes)
        return HistEvent.selection(selections);
    let mappedChanges = event.changes.map(mapping), before = mapping.mapDesc(event.changes, true);
    let fullMapping = event.mapped ? event.mapped.composeDesc(before) : before;
    return new HistEvent(mappedChanges, StateEffect.mapEffects(event.effects, mapping), fullMapping, event.startSelection.map(before), selections);
}
const joinableUserEvent = /^(input\.type|delete)($|\.)/;
class HistoryState {
    constructor(done, undone, prevTime = 0, prevUserEvent = undefined) {
        this.done = done;
        this.undone = undone;
        this.prevTime = prevTime;
        this.prevUserEvent = prevUserEvent;
    }
    isolate() {
        return this.prevTime ? new HistoryState(this.done, this.undone) : this;
    }
    addChanges(event, time, userEvent, config, tr) {
        let done = this.done, lastEvent = done[done.length - 1];
        if (lastEvent && lastEvent.changes && !lastEvent.changes.empty && event.changes &&
            (!userEvent || joinableUserEvent.test(userEvent)) &&
            ((!lastEvent.selectionsAfter.length &&
                time - this.prevTime < config.newGroupDelay &&
                config.joinToEvent(tr, isAdjacent(lastEvent.changes, event.changes))) ||
                // For compose (but not compose.start) events, always join with previous event
                userEvent == "input.type.compose")) {
            done = updateBranch(done, done.length - 1, config.minDepth, new HistEvent(event.changes.compose(lastEvent.changes), conc(event.effects, lastEvent.effects), lastEvent.mapped, lastEvent.startSelection, none));
        }
        else {
            done = updateBranch(done, done.length, config.minDepth, event);
        }
        return new HistoryState(done, none, time, userEvent);
    }
    addSelection(selection, time, userEvent, newGroupDelay) {
        let last = this.done.length ? this.done[this.done.length - 1].selectionsAfter : none;
        if (last.length > 0 &&
            time - this.prevTime < newGroupDelay &&
            userEvent == this.prevUserEvent && userEvent && /^select($|\.)/.test(userEvent) &&
            eqSelectionShape(last[last.length - 1], selection))
            return this;
        return new HistoryState(addSelection(this.done, selection), this.undone, time, userEvent);
    }
    addMapping(mapping) {
        return new HistoryState(addMappingToBranch(this.done, mapping), addMappingToBranch(this.undone, mapping), this.prevTime, this.prevUserEvent);
    }
    pop(side, state, onlySelection) {
        let branch = side == 0 /* BranchName.Done */ ? this.done : this.undone;
        if (branch.length == 0)
            return null;
        let event = branch[branch.length - 1], selection = event.selectionsAfter[0] || state.selection;
        if (onlySelection && event.selectionsAfter.length) {
            return state.update({
                selection: event.selectionsAfter[event.selectionsAfter.length - 1],
                annotations: fromHistory.of({ side, rest: popSelection(branch), selection }),
                userEvent: side == 0 /* BranchName.Done */ ? "select.undo" : "select.redo",
                scrollIntoView: true
            });
        }
        else if (!event.changes) {
            return null;
        }
        else {
            let rest = branch.length == 1 ? none : branch.slice(0, branch.length - 1);
            if (event.mapped)
                rest = addMappingToBranch(rest, event.mapped);
            return state.update({
                changes: event.changes,
                selection: event.startSelection,
                effects: event.effects,
                annotations: fromHistory.of({ side, rest, selection }),
                filter: false,
                userEvent: side == 0 /* BranchName.Done */ ? "undo" : "redo",
                scrollIntoView: true
            });
        }
    }
}
HistoryState.empty = /*@__PURE__*/new HistoryState(none, none);
/**
Default key bindings for the undo history.

- Mod-z: [`undo`](https://codemirror.net/6/docs/ref/#commands.undo).
- Mod-y (Mod-Shift-z on macOS) + Ctrl-Shift-z on Linux: [`redo`](https://codemirror.net/6/docs/ref/#commands.redo).
- Mod-u: [`undoSelection`](https://codemirror.net/6/docs/ref/#commands.undoSelection).
- Alt-u (Mod-Shift-u on macOS): [`redoSelection`](https://codemirror.net/6/docs/ref/#commands.redoSelection).
*/
const historyKeymap = [
    { key: "Mod-z", run: undo, preventDefault: true },
    { key: "Mod-y", mac: "Mod-Shift-z", run: redo, preventDefault: true },
    { linux: "Ctrl-Shift-z", run: redo, preventDefault: true },
    { key: "Mod-u", run: undoSelection, preventDefault: true },
    { key: "Alt-u", mac: "Mod-Shift-u", run: redoSelection, preventDefault: true }
];

function updateSel(sel, by) {
    return EditorSelection.create(sel.ranges.map(by), sel.mainIndex);
}
function setSel(state, selection) {
    return state.update({ selection, scrollIntoView: true, userEvent: "select" });
}
function moveSel({ state, dispatch }, how) {
    let selection = updateSel(state.selection, how);
    if (selection.eq(state.selection, true))
        return false;
    dispatch(setSel(state, selection));
    return true;
}
function rangeEnd(range, forward) {
    return EditorSelection.cursor(forward ? range.to : range.from);
}
function cursorByChar(view, forward) {
    return moveSel(view, range => range.empty ? view.moveByChar(range, forward) : rangeEnd(range, forward));
}
function ltrAtCursor(view) {
    return view.textDirectionAt(view.state.selection.main.head) == Direction.LTR;
}
/**
Move the selection one character to the left (which is backward in
left-to-right text, forward in right-to-left text).
*/
const cursorCharLeft = view => cursorByChar(view, !ltrAtCursor(view));
/**
Move the selection one character to the right.
*/
const cursorCharRight = view => cursorByChar(view, ltrAtCursor(view));
function cursorByGroup(view, forward) {
    return moveSel(view, range => range.empty ? view.moveByGroup(range, forward) : rangeEnd(range, forward));
}
/**
Move the selection to the left across one group of word or
non-word (but also non-space) characters.
*/
const cursorGroupLeft = view => cursorByGroup(view, !ltrAtCursor(view));
/**
Move the selection one group to the right.
*/
const cursorGroupRight = view => cursorByGroup(view, ltrAtCursor(view));
function interestingNode(state, node, bracketProp) {
    if (node.type.prop(bracketProp))
        return true;
    let len = node.to - node.from;
    return len && (len > 2 || /[^\s,.;:]/.test(state.sliceDoc(node.from, node.to))) || node.firstChild;
}
function moveBySyntax(state, start, forward) {
    let pos = syntaxTree(state).resolveInner(start.head);
    let bracketProp = forward ? NodeProp.closedBy : NodeProp.openedBy;
    // Scan forward through child nodes to see if there's an interesting
    // node ahead.
    for (let at = start.head;;) {
        let next = forward ? pos.childAfter(at) : pos.childBefore(at);
        if (!next)
            break;
        if (interestingNode(state, next, bracketProp))
            pos = next;
        else
            at = forward ? next.to : next.from;
    }
    let bracket = pos.type.prop(bracketProp), match, newPos;
    if (bracket && (match = forward ? matchBrackets(state, pos.from, 1) : matchBrackets(state, pos.to, -1)) && match.matched)
        newPos = forward ? match.end.to : match.end.from;
    else
        newPos = forward ? pos.to : pos.from;
    return EditorSelection.cursor(newPos, forward ? -1 : 1);
}
/**
Move the cursor over the next syntactic element to the left.
*/
const cursorSyntaxLeft = view => moveSel(view, range => moveBySyntax(view.state, range, !ltrAtCursor(view)));
/**
Move the cursor over the next syntactic element to the right.
*/
const cursorSyntaxRight = view => moveSel(view, range => moveBySyntax(view.state, range, ltrAtCursor(view)));
function cursorByLine(view, forward) {
    return moveSel(view, range => {
        if (!range.empty)
            return rangeEnd(range, forward);
        let moved = view.moveVertically(range, forward);
        return moved.head != range.head ? moved : view.moveToLineBoundary(range, forward);
    });
}
/**
Move the selection one line up.
*/
const cursorLineUp = view => cursorByLine(view, false);
/**
Move the selection one line down.
*/
const cursorLineDown = view => cursorByLine(view, true);
function pageInfo(view) {
    let selfScroll = view.scrollDOM.clientHeight < view.scrollDOM.scrollHeight - 2;
    let marginTop = 0, marginBottom = 0, height;
    if (selfScroll) {
        for (let source of view.state.facet(EditorView.scrollMargins)) {
            let margins = source(view);
            if (margins === null || margins === void 0 ? void 0 : margins.top)
                marginTop = Math.max(margins === null || margins === void 0 ? void 0 : margins.top, marginTop);
            if (margins === null || margins === void 0 ? void 0 : margins.bottom)
                marginBottom = Math.max(margins === null || margins === void 0 ? void 0 : margins.bottom, marginBottom);
        }
        height = view.scrollDOM.clientHeight - marginTop - marginBottom;
    }
    else {
        height = (view.dom.ownerDocument.defaultView || window).innerHeight;
    }
    return { marginTop, marginBottom, selfScroll,
        height: Math.max(view.defaultLineHeight, height - 5) };
}
function cursorByPage(view, forward) {
    let page = pageInfo(view);
    let { state } = view, selection = updateSel(state.selection, range => {
        return range.empty ? view.moveVertically(range, forward, page.height)
            : rangeEnd(range, forward);
    });
    if (selection.eq(state.selection))
        return false;
    let effect;
    if (page.selfScroll) {
        let startPos = view.coordsAtPos(state.selection.main.head);
        let scrollRect = view.scrollDOM.getBoundingClientRect();
        let scrollTop = scrollRect.top + page.marginTop, scrollBottom = scrollRect.bottom - page.marginBottom;
        if (startPos && startPos.top > scrollTop && startPos.bottom < scrollBottom)
            effect = EditorView.scrollIntoView(selection.main.head, { y: "start", yMargin: startPos.top - scrollTop });
    }
    view.dispatch(setSel(state, selection), { effects: effect });
    return true;
}
/**
Move the selection one page up.
*/
const cursorPageUp = view => cursorByPage(view, false);
/**
Move the selection one page down.
*/
const cursorPageDown = view => cursorByPage(view, true);
function moveByLineBoundary(view, start, forward) {
    let line = view.lineBlockAt(start.head), moved = view.moveToLineBoundary(start, forward);
    if (moved.head == start.head && moved.head != (forward ? line.to : line.from))
        moved = view.moveToLineBoundary(start, forward, false);
    if (!forward && moved.head == line.from && line.length) {
        let space = /^\s*/.exec(view.state.sliceDoc(line.from, Math.min(line.from + 100, line.to)))[0].length;
        if (space && start.head != line.from + space)
            moved = EditorSelection.cursor(line.from + space);
    }
    return moved;
}
/**
Move the selection to the next line wrap point, or to the end of
the line if there isn't one left on this line.
*/
const cursorLineBoundaryForward = view => moveSel(view, range => moveByLineBoundary(view, range, true));
/**
Move the selection to previous line wrap point, or failing that to
the start of the line. If the line is indented, and the cursor
isn't already at the end of the indentation, this will move to the
end of the indentation instead of the start of the line.
*/
const cursorLineBoundaryBackward = view => moveSel(view, range => moveByLineBoundary(view, range, false));
/**
Move the selection one line wrap point to the left.
*/
const cursorLineBoundaryLeft = view => moveSel(view, range => moveByLineBoundary(view, range, !ltrAtCursor(view)));
/**
Move the selection one line wrap point to the right.
*/
const cursorLineBoundaryRight = view => moveSel(view, range => moveByLineBoundary(view, range, ltrAtCursor(view)));
/**
Move the selection to the start of the line.
*/
const cursorLineStart = view => moveSel(view, range => EditorSelection.cursor(view.lineBlockAt(range.head).from, 1));
/**
Move the selection to the end of the line.
*/
const cursorLineEnd = view => moveSel(view, range => EditorSelection.cursor(view.lineBlockAt(range.head).to, -1));
function toMatchingBracket(state, dispatch, extend) {
    let found = false, selection = updateSel(state.selection, range => {
        let matching = matchBrackets(state, range.head, -1)
            || matchBrackets(state, range.head, 1)
            || (range.head > 0 && matchBrackets(state, range.head - 1, 1))
            || (range.head < state.doc.length && matchBrackets(state, range.head + 1, -1));
        if (!matching || !matching.end)
            return range;
        found = true;
        let head = matching.start.from == range.head ? matching.end.to : matching.end.from;
        return EditorSelection.cursor(head);
    });
    if (!found)
        return false;
    dispatch(setSel(state, selection));
    return true;
}
/**
Move the selection to the bracket matching the one it is currently
on, if any.
*/
const cursorMatchingBracket = ({ state, dispatch }) => toMatchingBracket(state, dispatch);
function extendSel(view, how) {
    let selection = updateSel(view.state.selection, range => {
        let head = how(range);
        return EditorSelection.range(range.anchor, head.head, head.goalColumn, head.bidiLevel || undefined);
    });
    if (selection.eq(view.state.selection))
        return false;
    view.dispatch(setSel(view.state, selection));
    return true;
}
function selectByChar(view, forward) {
    return extendSel(view, range => view.moveByChar(range, forward));
}
/**
Move the selection head one character to the left, while leaving
the anchor in place.
*/
const selectCharLeft = view => selectByChar(view, !ltrAtCursor(view));
/**
Move the selection head one character to the right.
*/
const selectCharRight = view => selectByChar(view, ltrAtCursor(view));
function selectByGroup(view, forward) {
    return extendSel(view, range => view.moveByGroup(range, forward));
}
/**
Move the selection head one [group](https://codemirror.net/6/docs/ref/#commands.cursorGroupLeft) to
the left.
*/
const selectGroupLeft = view => selectByGroup(view, !ltrAtCursor(view));
/**
Move the selection head one group to the right.
*/
const selectGroupRight = view => selectByGroup(view, ltrAtCursor(view));
/**
Move the selection head over the next syntactic element to the left.
*/
const selectSyntaxLeft = view => extendSel(view, range => moveBySyntax(view.state, range, !ltrAtCursor(view)));
/**
Move the selection head over the next syntactic element to the right.
*/
const selectSyntaxRight = view => extendSel(view, range => moveBySyntax(view.state, range, ltrAtCursor(view)));
function selectByLine(view, forward) {
    return extendSel(view, range => view.moveVertically(range, forward));
}
/**
Move the selection head one line up.
*/
const selectLineUp = view => selectByLine(view, false);
/**
Move the selection head one line down.
*/
const selectLineDown = view => selectByLine(view, true);
function selectByPage(view, forward) {
    return extendSel(view, range => view.moveVertically(range, forward, pageInfo(view).height));
}
/**
Move the selection head one page up.
*/
const selectPageUp = view => selectByPage(view, false);
/**
Move the selection head one page down.
*/
const selectPageDown = view => selectByPage(view, true);
/**
Move the selection head to the next line boundary.
*/
const selectLineBoundaryForward = view => extendSel(view, range => moveByLineBoundary(view, range, true));
/**
Move the selection head to the previous line boundary.
*/
const selectLineBoundaryBackward = view => extendSel(view, range => moveByLineBoundary(view, range, false));
/**
Move the selection head one line boundary to the left.
*/
const selectLineBoundaryLeft = view => extendSel(view, range => moveByLineBoundary(view, range, !ltrAtCursor(view)));
/**
Move the selection head one line boundary to the right.
*/
const selectLineBoundaryRight = view => extendSel(view, range => moveByLineBoundary(view, range, ltrAtCursor(view)));
/**
Move the selection head to the start of the line.
*/
const selectLineStart = view => extendSel(view, range => EditorSelection.cursor(view.lineBlockAt(range.head).from));
/**
Move the selection head to the end of the line.
*/
const selectLineEnd = view => extendSel(view, range => EditorSelection.cursor(view.lineBlockAt(range.head).to));
/**
Move the selection to the start of the document.
*/
const cursorDocStart = ({ state, dispatch }) => {
    dispatch(setSel(state, { anchor: 0 }));
    return true;
};
/**
Move the selection to the end of the document.
*/
const cursorDocEnd = ({ state, dispatch }) => {
    dispatch(setSel(state, { anchor: state.doc.length }));
    return true;
};
/**
Move the selection head to the start of the document.
*/
const selectDocStart = ({ state, dispatch }) => {
    dispatch(setSel(state, { anchor: state.selection.main.anchor, head: 0 }));
    return true;
};
/**
Move the selection head to the end of the document.
*/
const selectDocEnd = ({ state, dispatch }) => {
    dispatch(setSel(state, { anchor: state.selection.main.anchor, head: state.doc.length }));
    return true;
};
/**
Select the entire document.
*/
const selectAll = ({ state, dispatch }) => {
    dispatch(state.update({ selection: { anchor: 0, head: state.doc.length }, userEvent: "select" }));
    return true;
};
/**
Expand the selection to cover entire lines.
*/
const selectLine = ({ state, dispatch }) => {
    let ranges = selectedLineBlocks(state).map(({ from, to }) => EditorSelection.range(from, Math.min(to + 1, state.doc.length)));
    dispatch(state.update({ selection: EditorSelection.create(ranges), userEvent: "select" }));
    return true;
};
/**
Select the next syntactic construct that is larger than the
selection. Note that this will only work insofar as the language
[provider](https://codemirror.net/6/docs/ref/#language.language) you use builds up a full
syntax tree.
*/
const selectParentSyntax = ({ state, dispatch }) => {
    let selection = updateSel(state.selection, range => {
        var _a;
        let stack = syntaxTree(state).resolveStack(range.from, 1);
        for (let cur = stack; cur; cur = cur.next) {
            let { node } = cur;
            if (((node.from < range.from && node.to >= range.to) ||
                (node.to > range.to && node.from <= range.from)) &&
                ((_a = node.parent) === null || _a === void 0 ? void 0 : _a.parent))
                return EditorSelection.range(node.to, node.from);
        }
        return range;
    });
    dispatch(setSel(state, selection));
    return true;
};
/**
Simplify the current selection. When multiple ranges are selected,
reduce it to its main range. Otherwise, if the selection is
non-empty, convert it to a cursor selection.
*/
const simplifySelection = ({ state, dispatch }) => {
    let cur = state.selection, selection = null;
    if (cur.ranges.length > 1)
        selection = EditorSelection.create([cur.main]);
    else if (!cur.main.empty)
        selection = EditorSelection.create([EditorSelection.cursor(cur.main.head)]);
    if (!selection)
        return false;
    dispatch(setSel(state, selection));
    return true;
};
function deleteBy(target, by) {
    if (target.state.readOnly)
        return false;
    let event = "delete.selection", { state } = target;
    let changes = state.changeByRange(range => {
        let { from, to } = range;
        if (from == to) {
            let towards = by(range);
            if (towards < from) {
                event = "delete.backward";
                towards = skipAtomic(target, towards, false);
            }
            else if (towards > from) {
                event = "delete.forward";
                towards = skipAtomic(target, towards, true);
            }
            from = Math.min(from, towards);
            to = Math.max(to, towards);
        }
        else {
            from = skipAtomic(target, from, false);
            to = skipAtomic(target, to, true);
        }
        return from == to ? { range } : { changes: { from, to }, range: EditorSelection.cursor(from, from < range.head ? -1 : 1) };
    });
    if (changes.changes.empty)
        return false;
    target.dispatch(state.update(changes, {
        scrollIntoView: true,
        userEvent: event,
        effects: event == "delete.selection" ? EditorView.announce.of(state.phrase("Selection deleted")) : undefined
    }));
    return true;
}
function skipAtomic(target, pos, forward) {
    if (target instanceof EditorView)
        for (let ranges of target.state.facet(EditorView.atomicRanges).map(f => f(target)))
            ranges.between(pos, pos, (from, to) => {
                if (from < pos && to > pos)
                    pos = forward ? to : from;
            });
    return pos;
}
const deleteByChar = (target, forward, byIndentUnit) => deleteBy(target, range => {
    let pos = range.from, { state } = target, line = state.doc.lineAt(pos), before, targetPos;
    if (byIndentUnit && !forward && pos > line.from && pos < line.from + 200 &&
        !/[^ \t]/.test(before = line.text.slice(0, pos - line.from))) {
        if (before[before.length - 1] == "\t")
            return pos - 1;
        let col = countColumn(before, state.tabSize), drop = col % getIndentUnit(state) || getIndentUnit(state);
        for (let i = 0; i < drop && before[before.length - 1 - i] == " "; i++)
            pos--;
        targetPos = pos;
    }
    else {
        targetPos = findClusterBreak(line.text, pos - line.from, forward, forward) + line.from;
        if (targetPos == pos && line.number != (forward ? state.doc.lines : 1))
            targetPos += forward ? 1 : -1;
        else if (!forward && /[\ufe00-\ufe0f]/.test(line.text.slice(targetPos - line.from, pos - line.from)))
            targetPos = findClusterBreak(line.text, targetPos - line.from, false, false) + line.from;
    }
    return targetPos;
});
/**
Delete the selection, or, for cursor selections, the character or
indentation unit before the cursor.
*/
const deleteCharBackward = view => deleteByChar(view, false, true);
/**
Delete the selection or the character after the cursor.
*/
const deleteCharForward = view => deleteByChar(view, true, false);
const deleteByGroup = (target, forward) => deleteBy(target, range => {
    let pos = range.head, { state } = target, line = state.doc.lineAt(pos);
    let categorize = state.charCategorizer(pos);
    for (let cat = null;;) {
        if (pos == (forward ? line.to : line.from)) {
            if (pos == range.head && line.number != (forward ? state.doc.lines : 1))
                pos += forward ? 1 : -1;
            break;
        }
        let next = findClusterBreak(line.text, pos - line.from, forward) + line.from;
        let nextChar = line.text.slice(Math.min(pos, next) - line.from, Math.max(pos, next) - line.from);
        let nextCat = categorize(nextChar);
        if (cat != null && nextCat != cat)
            break;
        if (nextChar != " " || pos != range.head)
            cat = nextCat;
        pos = next;
    }
    return pos;
});
/**
Delete the selection or backward until the end of the next
[group](https://codemirror.net/6/docs/ref/#view.EditorView.moveByGroup), only skipping groups of
whitespace when they consist of a single space.
*/
const deleteGroupBackward = target => deleteByGroup(target, false);
/**
Delete the selection or forward until the end of the next group.
*/
const deleteGroupForward = target => deleteByGroup(target, true);
/**
Delete the selection, or, if it is a cursor selection, delete to
the end of the line. If the cursor is directly at the end of the
line, delete the line break after it.
*/
const deleteToLineEnd = view => deleteBy(view, range => {
    let lineEnd = view.lineBlockAt(range.head).to;
    return range.head < lineEnd ? lineEnd : Math.min(view.state.doc.length, range.head + 1);
});
/**
Delete the selection, or, if it is a cursor selection, delete to
the start of the line or the next line wrap before the cursor.
*/
const deleteLineBoundaryBackward = view => deleteBy(view, range => {
    let lineStart = view.moveToLineBoundary(range, false).head;
    return range.head > lineStart ? lineStart : Math.max(0, range.head - 1);
});
/**
Delete the selection, or, if it is a cursor selection, delete to
the end of the line or the next line wrap after the cursor.
*/
const deleteLineBoundaryForward = view => deleteBy(view, range => {
    let lineStart = view.moveToLineBoundary(range, true).head;
    return range.head < lineStart ? lineStart : Math.min(view.state.doc.length, range.head + 1);
});
/**
Replace each selection range with a line break, leaving the cursor
on the line before the break.
*/
const splitLine = ({ state, dispatch }) => {
    if (state.readOnly)
        return false;
    let changes = state.changeByRange(range => {
        return { changes: { from: range.from, to: range.to, insert: Text.of(["", ""]) },
            range: EditorSelection.cursor(range.from) };
    });
    dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
    return true;
};
/**
Flip the characters before and after the cursor(s).
*/
const transposeChars = ({ state, dispatch }) => {
    if (state.readOnly)
        return false;
    let changes = state.changeByRange(range => {
        if (!range.empty || range.from == 0 || range.from == state.doc.length)
            return { range };
        let pos = range.from, line = state.doc.lineAt(pos);
        let from = pos == line.from ? pos - 1 : findClusterBreak(line.text, pos - line.from, false) + line.from;
        let to = pos == line.to ? pos + 1 : findClusterBreak(line.text, pos - line.from, true) + line.from;
        return { changes: { from, to, insert: state.doc.slice(pos, to).append(state.doc.slice(from, pos)) },
            range: EditorSelection.cursor(to) };
    });
    if (changes.changes.empty)
        return false;
    dispatch(state.update(changes, { scrollIntoView: true, userEvent: "move.character" }));
    return true;
};
function selectedLineBlocks(state) {
    let blocks = [], upto = -1;
    for (let range of state.selection.ranges) {
        let startLine = state.doc.lineAt(range.from), endLine = state.doc.lineAt(range.to);
        if (!range.empty && range.to == endLine.from)
            endLine = state.doc.lineAt(range.to - 1);
        if (upto >= startLine.number) {
            let prev = blocks[blocks.length - 1];
            prev.to = endLine.to;
            prev.ranges.push(range);
        }
        else {
            blocks.push({ from: startLine.from, to: endLine.to, ranges: [range] });
        }
        upto = endLine.number + 1;
    }
    return blocks;
}
function moveLine(state, dispatch, forward) {
    if (state.readOnly)
        return false;
    let changes = [], ranges = [];
    for (let block of selectedLineBlocks(state)) {
        if (forward ? block.to == state.doc.length : block.from == 0)
            continue;
        let nextLine = state.doc.lineAt(forward ? block.to + 1 : block.from - 1);
        let size = nextLine.length + 1;
        if (forward) {
            changes.push({ from: block.to, to: nextLine.to }, { from: block.from, insert: nextLine.text + state.lineBreak });
            for (let r of block.ranges)
                ranges.push(EditorSelection.range(Math.min(state.doc.length, r.anchor + size), Math.min(state.doc.length, r.head + size)));
        }
        else {
            changes.push({ from: nextLine.from, to: block.from }, { from: block.to, insert: state.lineBreak + nextLine.text });
            for (let r of block.ranges)
                ranges.push(EditorSelection.range(r.anchor - size, r.head - size));
        }
    }
    if (!changes.length)
        return false;
    dispatch(state.update({
        changes,
        scrollIntoView: true,
        selection: EditorSelection.create(ranges, state.selection.mainIndex),
        userEvent: "move.line"
    }));
    return true;
}
/**
Move the selected lines up one line.
*/
const moveLineUp = ({ state, dispatch }) => moveLine(state, dispatch, false);
/**
Move the selected lines down one line.
*/
const moveLineDown = ({ state, dispatch }) => moveLine(state, dispatch, true);
function copyLine(state, dispatch, forward) {
    if (state.readOnly)
        return false;
    let changes = [];
    for (let block of selectedLineBlocks(state)) {
        if (forward)
            changes.push({ from: block.from, insert: state.doc.slice(block.from, block.to) + state.lineBreak });
        else
            changes.push({ from: block.to, insert: state.lineBreak + state.doc.slice(block.from, block.to) });
    }
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input.copyline" }));
    return true;
}
/**
Create a copy of the selected lines. Keep the selection in the top copy.
*/
const copyLineUp = ({ state, dispatch }) => copyLine(state, dispatch, false);
/**
Create a copy of the selected lines. Keep the selection in the bottom copy.
*/
const copyLineDown = ({ state, dispatch }) => copyLine(state, dispatch, true);
/**
Delete selected lines.
*/
const deleteLine = view => {
    if (view.state.readOnly)
        return false;
    let { state } = view, changes = state.changes(selectedLineBlocks(state).map(({ from, to }) => {
        if (from > 0)
            from--;
        else if (to < state.doc.length)
            to++;
        return { from, to };
    }));
    let selection = updateSel(state.selection, range => {
        let dist = undefined;
        if (view.lineWrapping) {
            let block = view.lineBlockAt(range.head), pos = view.coordsAtPos(range.head, range.assoc || 1);
            if (pos)
                dist = (block.bottom + view.documentTop) - pos.bottom + view.defaultLineHeight / 2;
        }
        return view.moveVertically(range, true, dist);
    }).map(changes);
    view.dispatch({ changes, selection, scrollIntoView: true, userEvent: "delete.line" });
    return true;
};
function isBetweenBrackets(state, pos) {
    if (/\(\)|\[\]|\{\}/.test(state.sliceDoc(pos - 1, pos + 1)))
        return { from: pos, to: pos };
    let context = syntaxTree(state).resolveInner(pos);
    let before = context.childBefore(pos), after = context.childAfter(pos), closedBy;
    if (before && after && before.to <= pos && after.from >= pos &&
        (closedBy = before.type.prop(NodeProp.closedBy)) && closedBy.indexOf(after.name) > -1 &&
        state.doc.lineAt(before.to).from == state.doc.lineAt(after.from).from &&
        !/\S/.test(state.sliceDoc(before.to, after.from)))
        return { from: before.to, to: after.from };
    return null;
}
/**
Replace the selection with a newline and indent the newly created
line(s). If the current line consists only of whitespace, this
will also delete that whitespace. When the cursor is between
matching brackets, an additional newline will be inserted after
the cursor.
*/
const insertNewlineAndIndent = /*@__PURE__*/newlineAndIndent(false);
/**
Create a blank, indented line below the current line.
*/
const insertBlankLine = /*@__PURE__*/newlineAndIndent(true);
function newlineAndIndent(atEof) {
    return ({ state, dispatch }) => {
        if (state.readOnly)
            return false;
        let changes = state.changeByRange(range => {
            let { from, to } = range, line = state.doc.lineAt(from);
            let explode = !atEof && from == to && isBetweenBrackets(state, from);
            if (atEof)
                from = to = (to <= line.to ? line : state.doc.lineAt(to)).to;
            let cx = new IndentContext(state, { simulateBreak: from, simulateDoubleBreak: !!explode });
            let indent = getIndentation(cx, from);
            if (indent == null)
                indent = countColumn(/^\s*/.exec(state.doc.lineAt(from).text)[0], state.tabSize);
            while (to < line.to && /\s/.test(line.text[to - line.from]))
                to++;
            if (explode)
                ({ from, to } = explode);
            else if (from > line.from && from < line.from + 100 && !/\S/.test(line.text.slice(0, from)))
                from = line.from;
            let insert = ["", indentString(state, indent)];
            if (explode)
                insert.push(indentString(state, cx.lineIndent(line.from, -1)));
            return { changes: { from, to, insert: Text.of(insert) },
                range: EditorSelection.cursor(from + 1 + insert[1].length) };
        });
        dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
        return true;
    };
}
function changeBySelectedLine(state, f) {
    let atLine = -1;
    return state.changeByRange(range => {
        let changes = [];
        for (let pos = range.from; pos <= range.to;) {
            let line = state.doc.lineAt(pos);
            if (line.number > atLine && (range.empty || range.to > line.from)) {
                f(line, changes, range);
                atLine = line.number;
            }
            pos = line.to + 1;
        }
        let changeSet = state.changes(changes);
        return { changes,
            range: EditorSelection.range(changeSet.mapPos(range.anchor, 1), changeSet.mapPos(range.head, 1)) };
    });
}
/**
Auto-indent the selected lines. This uses the [indentation service
facet](https://codemirror.net/6/docs/ref/#language.indentService) as source for auto-indent
information.
*/
const indentSelection = ({ state, dispatch }) => {
    if (state.readOnly)
        return false;
    let updated = Object.create(null);
    let context = new IndentContext(state, { overrideIndentation: start => {
            let found = updated[start];
            return found == null ? -1 : found;
        } });
    let changes = changeBySelectedLine(state, (line, changes, range) => {
        let indent = getIndentation(context, line.from);
        if (indent == null)
            return;
        if (!/\S/.test(line.text))
            indent = 0;
        let cur = /^\s*/.exec(line.text)[0];
        let norm = indentString(state, indent);
        if (cur != norm || range.from < line.from + cur.length) {
            updated[line.from] = indent;
            changes.push({ from: line.from, to: line.from + cur.length, insert: norm });
        }
    });
    if (!changes.changes.empty)
        dispatch(state.update(changes, { userEvent: "indent" }));
    return true;
};
/**
Add a [unit](https://codemirror.net/6/docs/ref/#language.indentUnit) of indentation to all selected
lines.
*/
const indentMore = ({ state, dispatch }) => {
    if (state.readOnly)
        return false;
    dispatch(state.update(changeBySelectedLine(state, (line, changes) => {
        changes.push({ from: line.from, insert: state.facet(indentUnit) });
    }), { userEvent: "input.indent" }));
    return true;
};
/**
Remove a [unit](https://codemirror.net/6/docs/ref/#language.indentUnit) of indentation from all
selected lines.
*/
const indentLess = ({ state, dispatch }) => {
    if (state.readOnly)
        return false;
    dispatch(state.update(changeBySelectedLine(state, (line, changes) => {
        let space = /^\s*/.exec(line.text)[0];
        if (!space)
            return;
        let col = countColumn(space, state.tabSize), keep = 0;
        let insert = indentString(state, Math.max(0, col - getIndentUnit(state)));
        while (keep < space.length && keep < insert.length && space.charCodeAt(keep) == insert.charCodeAt(keep))
            keep++;
        changes.push({ from: line.from + keep, to: line.from + space.length, insert: insert.slice(keep) });
    }), { userEvent: "delete.dedent" }));
    return true;
};
/**
Enables or disables
[tab-focus mode](https://codemirror.net/6/docs/ref/#view.EditorView.setTabFocusMode). While on, this
prevents the editor's key bindings from capturing Tab or
Shift-Tab, making it possible for the user to move focus out of
the editor with the keyboard.
*/
const toggleTabFocusMode = view => {
    view.setTabFocusMode();
    return true;
};
/**
Array of key bindings containing the Emacs-style bindings that are
available on macOS by default.

 - Ctrl-b: [`cursorCharLeft`](https://codemirror.net/6/docs/ref/#commands.cursorCharLeft) ([`selectCharLeft`](https://codemirror.net/6/docs/ref/#commands.selectCharLeft) with Shift)
 - Ctrl-f: [`cursorCharRight`](https://codemirror.net/6/docs/ref/#commands.cursorCharRight) ([`selectCharRight`](https://codemirror.net/6/docs/ref/#commands.selectCharRight) with Shift)
 - Ctrl-p: [`cursorLineUp`](https://codemirror.net/6/docs/ref/#commands.cursorLineUp) ([`selectLineUp`](https://codemirror.net/6/docs/ref/#commands.selectLineUp) with Shift)
 - Ctrl-n: [`cursorLineDown`](https://codemirror.net/6/docs/ref/#commands.cursorLineDown) ([`selectLineDown`](https://codemirror.net/6/docs/ref/#commands.selectLineDown) with Shift)
 - Ctrl-a: [`cursorLineStart`](https://codemirror.net/6/docs/ref/#commands.cursorLineStart) ([`selectLineStart`](https://codemirror.net/6/docs/ref/#commands.selectLineStart) with Shift)
 - Ctrl-e: [`cursorLineEnd`](https://codemirror.net/6/docs/ref/#commands.cursorLineEnd) ([`selectLineEnd`](https://codemirror.net/6/docs/ref/#commands.selectLineEnd) with Shift)
 - Ctrl-d: [`deleteCharForward`](https://codemirror.net/6/docs/ref/#commands.deleteCharForward)
 - Ctrl-h: [`deleteCharBackward`](https://codemirror.net/6/docs/ref/#commands.deleteCharBackward)
 - Ctrl-k: [`deleteToLineEnd`](https://codemirror.net/6/docs/ref/#commands.deleteToLineEnd)
 - Ctrl-Alt-h: [`deleteGroupBackward`](https://codemirror.net/6/docs/ref/#commands.deleteGroupBackward)
 - Ctrl-o: [`splitLine`](https://codemirror.net/6/docs/ref/#commands.splitLine)
 - Ctrl-t: [`transposeChars`](https://codemirror.net/6/docs/ref/#commands.transposeChars)
 - Ctrl-v: [`cursorPageDown`](https://codemirror.net/6/docs/ref/#commands.cursorPageDown)
 - Alt-v: [`cursorPageUp`](https://codemirror.net/6/docs/ref/#commands.cursorPageUp)
*/
const emacsStyleKeymap = [
    { key: "Ctrl-b", run: cursorCharLeft, shift: selectCharLeft, preventDefault: true },
    { key: "Ctrl-f", run: cursorCharRight, shift: selectCharRight },
    { key: "Ctrl-p", run: cursorLineUp, shift: selectLineUp },
    { key: "Ctrl-n", run: cursorLineDown, shift: selectLineDown },
    { key: "Ctrl-a", run: cursorLineStart, shift: selectLineStart },
    { key: "Ctrl-e", run: cursorLineEnd, shift: selectLineEnd },
    { key: "Ctrl-d", run: deleteCharForward },
    { key: "Ctrl-h", run: deleteCharBackward },
    { key: "Ctrl-k", run: deleteToLineEnd },
    { key: "Ctrl-Alt-h", run: deleteGroupBackward },
    { key: "Ctrl-o", run: splitLine },
    { key: "Ctrl-t", run: transposeChars },
    { key: "Ctrl-v", run: cursorPageDown },
];
/**
An array of key bindings closely sticking to platform-standard or
widely used bindings. (This includes the bindings from
[`emacsStyleKeymap`](https://codemirror.net/6/docs/ref/#commands.emacsStyleKeymap), with their `key`
property changed to `mac`.)

 - ArrowLeft: [`cursorCharLeft`](https://codemirror.net/6/docs/ref/#commands.cursorCharLeft) ([`selectCharLeft`](https://codemirror.net/6/docs/ref/#commands.selectCharLeft) with Shift)
 - ArrowRight: [`cursorCharRight`](https://codemirror.net/6/docs/ref/#commands.cursorCharRight) ([`selectCharRight`](https://codemirror.net/6/docs/ref/#commands.selectCharRight) with Shift)
 - Ctrl-ArrowLeft (Alt-ArrowLeft on macOS): [`cursorGroupLeft`](https://codemirror.net/6/docs/ref/#commands.cursorGroupLeft) ([`selectGroupLeft`](https://codemirror.net/6/docs/ref/#commands.selectGroupLeft) with Shift)
 - Ctrl-ArrowRight (Alt-ArrowRight on macOS): [`cursorGroupRight`](https://codemirror.net/6/docs/ref/#commands.cursorGroupRight) ([`selectGroupRight`](https://codemirror.net/6/docs/ref/#commands.selectGroupRight) with Shift)
 - Cmd-ArrowLeft (on macOS): [`cursorLineStart`](https://codemirror.net/6/docs/ref/#commands.cursorLineStart) ([`selectLineStart`](https://codemirror.net/6/docs/ref/#commands.selectLineStart) with Shift)
 - Cmd-ArrowRight (on macOS): [`cursorLineEnd`](https://codemirror.net/6/docs/ref/#commands.cursorLineEnd) ([`selectLineEnd`](https://codemirror.net/6/docs/ref/#commands.selectLineEnd) with Shift)
 - ArrowUp: [`cursorLineUp`](https://codemirror.net/6/docs/ref/#commands.cursorLineUp) ([`selectLineUp`](https://codemirror.net/6/docs/ref/#commands.selectLineUp) with Shift)
 - ArrowDown: [`cursorLineDown`](https://codemirror.net/6/docs/ref/#commands.cursorLineDown) ([`selectLineDown`](https://codemirror.net/6/docs/ref/#commands.selectLineDown) with Shift)
 - Cmd-ArrowUp (on macOS): [`cursorDocStart`](https://codemirror.net/6/docs/ref/#commands.cursorDocStart) ([`selectDocStart`](https://codemirror.net/6/docs/ref/#commands.selectDocStart) with Shift)
 - Cmd-ArrowDown (on macOS): [`cursorDocEnd`](https://codemirror.net/6/docs/ref/#commands.cursorDocEnd) ([`selectDocEnd`](https://codemirror.net/6/docs/ref/#commands.selectDocEnd) with Shift)
 - Ctrl-ArrowUp (on macOS): [`cursorPageUp`](https://codemirror.net/6/docs/ref/#commands.cursorPageUp) ([`selectPageUp`](https://codemirror.net/6/docs/ref/#commands.selectPageUp) with Shift)
 - Ctrl-ArrowDown (on macOS): [`cursorPageDown`](https://codemirror.net/6/docs/ref/#commands.cursorPageDown) ([`selectPageDown`](https://codemirror.net/6/docs/ref/#commands.selectPageDown) with Shift)
 - PageUp: [`cursorPageUp`](https://codemirror.net/6/docs/ref/#commands.cursorPageUp) ([`selectPageUp`](https://codemirror.net/6/docs/ref/#commands.selectPageUp) with Shift)
 - PageDown: [`cursorPageDown`](https://codemirror.net/6/docs/ref/#commands.cursorPageDown) ([`selectPageDown`](https://codemirror.net/6/docs/ref/#commands.selectPageDown) with Shift)
 - Home: [`cursorLineBoundaryBackward`](https://codemirror.net/6/docs/ref/#commands.cursorLineBoundaryBackward) ([`selectLineBoundaryBackward`](https://codemirror.net/6/docs/ref/#commands.selectLineBoundaryBackward) with Shift)
 - End: [`cursorLineBoundaryForward`](https://codemirror.net/6/docs/ref/#commands.cursorLineBoundaryForward) ([`selectLineBoundaryForward`](https://codemirror.net/6/docs/ref/#commands.selectLineBoundaryForward) with Shift)
 - Ctrl-Home (Cmd-Home on macOS): [`cursorDocStart`](https://codemirror.net/6/docs/ref/#commands.cursorDocStart) ([`selectDocStart`](https://codemirror.net/6/docs/ref/#commands.selectDocStart) with Shift)
 - Ctrl-End (Cmd-Home on macOS): [`cursorDocEnd`](https://codemirror.net/6/docs/ref/#commands.cursorDocEnd) ([`selectDocEnd`](https://codemirror.net/6/docs/ref/#commands.selectDocEnd) with Shift)
 - Enter: [`insertNewlineAndIndent`](https://codemirror.net/6/docs/ref/#commands.insertNewlineAndIndent)
 - Ctrl-a (Cmd-a on macOS): [`selectAll`](https://codemirror.net/6/docs/ref/#commands.selectAll)
 - Backspace: [`deleteCharBackward`](https://codemirror.net/6/docs/ref/#commands.deleteCharBackward)
 - Delete: [`deleteCharForward`](https://codemirror.net/6/docs/ref/#commands.deleteCharForward)
 - Ctrl-Backspace (Alt-Backspace on macOS): [`deleteGroupBackward`](https://codemirror.net/6/docs/ref/#commands.deleteGroupBackward)
 - Ctrl-Delete (Alt-Delete on macOS): [`deleteGroupForward`](https://codemirror.net/6/docs/ref/#commands.deleteGroupForward)
 - Cmd-Backspace (macOS): [`deleteLineBoundaryBackward`](https://codemirror.net/6/docs/ref/#commands.deleteLineBoundaryBackward).
 - Cmd-Delete (macOS): [`deleteLineBoundaryForward`](https://codemirror.net/6/docs/ref/#commands.deleteLineBoundaryForward).
*/
const standardKeymap = /*@__PURE__*/[
    { key: "ArrowLeft", run: cursorCharLeft, shift: selectCharLeft, preventDefault: true },
    { key: "Mod-ArrowLeft", mac: "Alt-ArrowLeft", run: cursorGroupLeft, shift: selectGroupLeft, preventDefault: true },
    { mac: "Cmd-ArrowLeft", run: cursorLineBoundaryLeft, shift: selectLineBoundaryLeft, preventDefault: true },
    { key: "ArrowRight", run: cursorCharRight, shift: selectCharRight, preventDefault: true },
    { key: "Mod-ArrowRight", mac: "Alt-ArrowRight", run: cursorGroupRight, shift: selectGroupRight, preventDefault: true },
    { mac: "Cmd-ArrowRight", run: cursorLineBoundaryRight, shift: selectLineBoundaryRight, preventDefault: true },
    { key: "ArrowUp", run: cursorLineUp, shift: selectLineUp, preventDefault: true },
    { mac: "Cmd-ArrowUp", run: cursorDocStart, shift: selectDocStart },
    { mac: "Ctrl-ArrowUp", run: cursorPageUp, shift: selectPageUp },
    { key: "ArrowDown", run: cursorLineDown, shift: selectLineDown, preventDefault: true },
    { mac: "Cmd-ArrowDown", run: cursorDocEnd, shift: selectDocEnd },
    { mac: "Ctrl-ArrowDown", run: cursorPageDown, shift: selectPageDown },
    { key: "PageUp", run: cursorPageUp, shift: selectPageUp },
    { key: "PageDown", run: cursorPageDown, shift: selectPageDown },
    { key: "Home", run: cursorLineBoundaryBackward, shift: selectLineBoundaryBackward, preventDefault: true },
    { key: "Mod-Home", run: cursorDocStart, shift: selectDocStart },
    { key: "End", run: cursorLineBoundaryForward, shift: selectLineBoundaryForward, preventDefault: true },
    { key: "Mod-End", run: cursorDocEnd, shift: selectDocEnd },
    { key: "Enter", run: insertNewlineAndIndent },
    { key: "Mod-a", run: selectAll },
    { key: "Backspace", run: deleteCharBackward, shift: deleteCharBackward },
    { key: "Delete", run: deleteCharForward },
    { key: "Mod-Backspace", mac: "Alt-Backspace", run: deleteGroupBackward },
    { key: "Mod-Delete", mac: "Alt-Delete", run: deleteGroupForward },
    { mac: "Mod-Backspace", run: deleteLineBoundaryBackward },
    { mac: "Mod-Delete", run: deleteLineBoundaryForward }
].concat(/*@__PURE__*/emacsStyleKeymap.map(b => ({ mac: b.key, run: b.run, shift: b.shift })));
/**
The default keymap. Includes all bindings from
[`standardKeymap`](https://codemirror.net/6/docs/ref/#commands.standardKeymap) plus the following:

- Alt-ArrowLeft (Ctrl-ArrowLeft on macOS): [`cursorSyntaxLeft`](https://codemirror.net/6/docs/ref/#commands.cursorSyntaxLeft) ([`selectSyntaxLeft`](https://codemirror.net/6/docs/ref/#commands.selectSyntaxLeft) with Shift)
- Alt-ArrowRight (Ctrl-ArrowRight on macOS): [`cursorSyntaxRight`](https://codemirror.net/6/docs/ref/#commands.cursorSyntaxRight) ([`selectSyntaxRight`](https://codemirror.net/6/docs/ref/#commands.selectSyntaxRight) with Shift)
- Alt-ArrowUp: [`moveLineUp`](https://codemirror.net/6/docs/ref/#commands.moveLineUp)
- Alt-ArrowDown: [`moveLineDown`](https://codemirror.net/6/docs/ref/#commands.moveLineDown)
- Shift-Alt-ArrowUp: [`copyLineUp`](https://codemirror.net/6/docs/ref/#commands.copyLineUp)
- Shift-Alt-ArrowDown: [`copyLineDown`](https://codemirror.net/6/docs/ref/#commands.copyLineDown)
- Escape: [`simplifySelection`](https://codemirror.net/6/docs/ref/#commands.simplifySelection)
- Ctrl-Enter (Cmd-Enter on macOS): [`insertBlankLine`](https://codemirror.net/6/docs/ref/#commands.insertBlankLine)
- Alt-l (Ctrl-l on macOS): [`selectLine`](https://codemirror.net/6/docs/ref/#commands.selectLine)
- Ctrl-i (Cmd-i on macOS): [`selectParentSyntax`](https://codemirror.net/6/docs/ref/#commands.selectParentSyntax)
- Ctrl-[ (Cmd-[ on macOS): [`indentLess`](https://codemirror.net/6/docs/ref/#commands.indentLess)
- Ctrl-] (Cmd-] on macOS): [`indentMore`](https://codemirror.net/6/docs/ref/#commands.indentMore)
- Ctrl-Alt-\\ (Cmd-Alt-\\ on macOS): [`indentSelection`](https://codemirror.net/6/docs/ref/#commands.indentSelection)
- Shift-Ctrl-k (Shift-Cmd-k on macOS): [`deleteLine`](https://codemirror.net/6/docs/ref/#commands.deleteLine)
- Shift-Ctrl-\\ (Shift-Cmd-\\ on macOS): [`cursorMatchingBracket`](https://codemirror.net/6/docs/ref/#commands.cursorMatchingBracket)
- Ctrl-/ (Cmd-/ on macOS): [`toggleComment`](https://codemirror.net/6/docs/ref/#commands.toggleComment).
- Shift-Alt-a: [`toggleBlockComment`](https://codemirror.net/6/docs/ref/#commands.toggleBlockComment).
- Ctrl-m (Alt-Shift-m on macOS): [`toggleTabFocusMode`](https://codemirror.net/6/docs/ref/#commands.toggleTabFocusMode).
*/
const defaultKeymap = /*@__PURE__*/[
    { key: "Alt-ArrowLeft", mac: "Ctrl-ArrowLeft", run: cursorSyntaxLeft, shift: selectSyntaxLeft },
    { key: "Alt-ArrowRight", mac: "Ctrl-ArrowRight", run: cursorSyntaxRight, shift: selectSyntaxRight },
    { key: "Alt-ArrowUp", run: moveLineUp },
    { key: "Shift-Alt-ArrowUp", run: copyLineUp },
    { key: "Alt-ArrowDown", run: moveLineDown },
    { key: "Shift-Alt-ArrowDown", run: copyLineDown },
    { key: "Escape", run: simplifySelection },
    { key: "Mod-Enter", run: insertBlankLine },
    { key: "Alt-l", mac: "Ctrl-l", run: selectLine },
    { key: "Mod-i", run: selectParentSyntax, preventDefault: true },
    { key: "Mod-[", run: indentLess },
    { key: "Mod-]", run: indentMore },
    { key: "Mod-Alt-\\", run: indentSelection },
    { key: "Shift-Mod-k", run: deleteLine },
    { key: "Shift-Mod-\\", run: cursorMatchingBracket },
    { key: "Mod-/", run: toggleComment },
    { key: "Alt-A", run: toggleBlockComment },
    { key: "Ctrl-m", mac: "Shift-Alt-m", run: toggleTabFocusMode },
].concat(standardKeymap);

/**
A parse stack. These are used internally by the parser to track
parsing progress. They also provide some properties and methods
that external code such as a tokenizer can use to get information
about the parse state.
*/
class Stack {
    /**
    @internal
    */
    constructor(
    /**
    The parse that this stack is part of @internal
    */
    p, 
    /**
    Holds state, input pos, buffer index triplets for all but the
    top state @internal
    */
    stack, 
    /**
    The current parse state @internal
    */
    state, 
    // The position at which the next reduce should take place. This
    // can be less than `this.pos` when skipped expressions have been
    // added to the stack (which should be moved outside of the next
    // reduction)
    /**
    @internal
    */
    reducePos, 
    /**
    The input position up to which this stack has parsed.
    */
    pos, 
    /**
    The dynamic score of the stack, including dynamic precedence
    and error-recovery penalties
    @internal
    */
    score, 
    // The output buffer. Holds (type, start, end, size) quads
    // representing nodes created by the parser, where `size` is
    // amount of buffer array entries covered by this node.
    /**
    @internal
    */
    buffer, 
    // The base offset of the buffer. When stacks are split, the split
    // instance shared the buffer history with its parent up to
    // `bufferBase`, which is the absolute offset (including the
    // offset of previous splits) into the buffer at which this stack
    // starts writing.
    /**
    @internal
    */
    bufferBase, 
    /**
    @internal
    */
    curContext, 
    /**
    @internal
    */
    lookAhead = 0, 
    // A parent stack from which this was split off, if any. This is
    // set up so that it always points to a stack that has some
    // additional buffer content, never to a stack with an equal
    // `bufferBase`.
    /**
    @internal
    */
    parent) {
        this.p = p;
        this.stack = stack;
        this.state = state;
        this.reducePos = reducePos;
        this.pos = pos;
        this.score = score;
        this.buffer = buffer;
        this.bufferBase = bufferBase;
        this.curContext = curContext;
        this.lookAhead = lookAhead;
        this.parent = parent;
    }
    /**
    @internal
    */
    toString() {
        return `[${this.stack.filter((_, i) => i % 3 == 0).concat(this.state)}]@${this.pos}${this.score ? "!" + this.score : ""}`;
    }
    // Start an empty stack
    /**
    @internal
    */
    static start(p, state, pos = 0) {
        let cx = p.parser.context;
        return new Stack(p, [], state, pos, pos, 0, [], 0, cx ? new StackContext(cx, cx.start) : null, 0, null);
    }
    /**
    The stack's current [context](#lr.ContextTracker) value, if
    any. Its type will depend on the context tracker's type
    parameter, or it will be `null` if there is no context
    tracker.
    */
    get context() { return this.curContext ? this.curContext.context : null; }
    // Push a state onto the stack, tracking its start position as well
    // as the buffer base at that point.
    /**
    @internal
    */
    pushState(state, start) {
        this.stack.push(this.state, start, this.bufferBase + this.buffer.length);
        this.state = state;
    }
    // Apply a reduce action
    /**
    @internal
    */
    reduce(action) {
        var _a;
        let depth = action >> 19 /* Action.ReduceDepthShift */, type = action & 65535 /* Action.ValueMask */;
        let { parser } = this.p;
        if (this.reducePos < this.pos - 25 /* Lookahead.Margin */)
            this.setLookAhead(this.pos);
        let dPrec = parser.dynamicPrecedence(type);
        if (dPrec)
            this.score += dPrec;
        if (depth == 0) {
            this.pushState(parser.getGoto(this.state, type, true), this.reducePos);
            // Zero-depth reductions are a special case—they add stuff to
            // the stack without popping anything off.
            if (type < parser.minRepeatTerm)
                this.storeNode(type, this.reducePos, this.reducePos, 4, true);
            this.reduceContext(type, this.reducePos);
            return;
        }
        // Find the base index into `this.stack`, content after which will
        // be dropped. Note that with `StayFlag` reductions we need to
        // consume two extra frames (the dummy parent node for the skipped
        // expression and the state that we'll be staying in, which should
        // be moved to `this.state`).
        let base = this.stack.length - ((depth - 1) * 3) - (action & 262144 /* Action.StayFlag */ ? 6 : 0);
        let start = base ? this.stack[base - 2] : this.p.ranges[0].from, size = this.reducePos - start;
        // This is a kludge to try and detect overly deep left-associative
        // trees, which will not increase the parse stack depth and thus
        // won't be caught by the regular stack-depth limit check.
        if (size >= 2000 /* Recover.MinBigReduction */ && !((_a = this.p.parser.nodeSet.types[type]) === null || _a === void 0 ? void 0 : _a.isAnonymous)) {
            if (start == this.p.lastBigReductionStart) {
                this.p.bigReductionCount++;
                this.p.lastBigReductionSize = size;
            }
            else if (this.p.lastBigReductionSize < size) {
                this.p.bigReductionCount = 1;
                this.p.lastBigReductionStart = start;
                this.p.lastBigReductionSize = size;
            }
        }
        let bufferBase = base ? this.stack[base - 1] : 0, count = this.bufferBase + this.buffer.length - bufferBase;
        // Store normal terms or `R -> R R` repeat reductions
        if (type < parser.minRepeatTerm || (action & 131072 /* Action.RepeatFlag */)) {
            let pos = parser.stateFlag(this.state, 1 /* StateFlag.Skipped */) ? this.pos : this.reducePos;
            this.storeNode(type, start, pos, count + 4, true);
        }
        if (action & 262144 /* Action.StayFlag */) {
            this.state = this.stack[base];
        }
        else {
            let baseStateID = this.stack[base - 3];
            this.state = parser.getGoto(baseStateID, type, true);
        }
        while (this.stack.length > base)
            this.stack.pop();
        this.reduceContext(type, start);
    }
    // Shift a value into the buffer
    /**
    @internal
    */
    storeNode(term, start, end, size = 4, isReduce = false) {
        if (term == 0 /* Term.Err */ &&
            (!this.stack.length || this.stack[this.stack.length - 1] < this.buffer.length + this.bufferBase)) {
            // Try to omit/merge adjacent error nodes
            let cur = this, top = this.buffer.length;
            if (top == 0 && cur.parent) {
                top = cur.bufferBase - cur.parent.bufferBase;
                cur = cur.parent;
            }
            if (top > 0 && cur.buffer[top - 4] == 0 /* Term.Err */ && cur.buffer[top - 1] > -1) {
                if (start == end)
                    return;
                if (cur.buffer[top - 2] >= start) {
                    cur.buffer[top - 2] = end;
                    return;
                }
            }
        }
        if (!isReduce || this.pos == end) { // Simple case, just append
            this.buffer.push(term, start, end, size);
        }
        else { // There may be skipped nodes that have to be moved forward
            let index = this.buffer.length;
            if (index > 0 && this.buffer[index - 4] != 0 /* Term.Err */)
                while (index > 0 && this.buffer[index - 2] > end) {
                    // Move this record forward
                    this.buffer[index] = this.buffer[index - 4];
                    this.buffer[index + 1] = this.buffer[index - 3];
                    this.buffer[index + 2] = this.buffer[index - 2];
                    this.buffer[index + 3] = this.buffer[index - 1];
                    index -= 4;
                    if (size > 4)
                        size -= 4;
                }
            this.buffer[index] = term;
            this.buffer[index + 1] = start;
            this.buffer[index + 2] = end;
            this.buffer[index + 3] = size;
        }
    }
    // Apply a shift action
    /**
    @internal
    */
    shift(action, type, start, end) {
        if (action & 131072 /* Action.GotoFlag */) {
            this.pushState(action & 65535 /* Action.ValueMask */, this.pos);
        }
        else if ((action & 262144 /* Action.StayFlag */) == 0) { // Regular shift
            let nextState = action, { parser } = this.p;
            if (end > this.pos || type <= parser.maxNode) {
                this.pos = end;
                if (!parser.stateFlag(nextState, 1 /* StateFlag.Skipped */))
                    this.reducePos = end;
            }
            this.pushState(nextState, start);
            this.shiftContext(type, start);
            if (type <= parser.maxNode)
                this.buffer.push(type, start, end, 4);
        }
        else { // Shift-and-stay, which means this is a skipped token
            this.pos = end;
            this.shiftContext(type, start);
            if (type <= this.p.parser.maxNode)
                this.buffer.push(type, start, end, 4);
        }
    }
    // Apply an action
    /**
    @internal
    */
    apply(action, next, nextStart, nextEnd) {
        if (action & 65536 /* Action.ReduceFlag */)
            this.reduce(action);
        else
            this.shift(action, next, nextStart, nextEnd);
    }
    // Add a prebuilt (reused) node into the buffer.
    /**
    @internal
    */
    useNode(value, next) {
        let index = this.p.reused.length - 1;
        if (index < 0 || this.p.reused[index] != value) {
            this.p.reused.push(value);
            index++;
        }
        let start = this.pos;
        this.reducePos = this.pos = start + value.length;
        this.pushState(next, start);
        this.buffer.push(index, start, this.reducePos, -1 /* size == -1 means this is a reused value */);
        if (this.curContext)
            this.updateContext(this.curContext.tracker.reuse(this.curContext.context, value, this, this.p.stream.reset(this.pos - value.length)));
    }
    // Split the stack. Due to the buffer sharing and the fact
    // that `this.stack` tends to stay quite shallow, this isn't very
    // expensive.
    /**
    @internal
    */
    split() {
        let parent = this;
        let off = parent.buffer.length;
        // Because the top of the buffer (after this.pos) may be mutated
        // to reorder reductions and skipped tokens, and shared buffers
        // should be immutable, this copies any outstanding skipped tokens
        // to the new buffer, and puts the base pointer before them.
        while (off > 0 && parent.buffer[off - 2] > parent.reducePos)
            off -= 4;
        let buffer = parent.buffer.slice(off), base = parent.bufferBase + off;
        // Make sure parent points to an actual parent with content, if there is such a parent.
        while (parent && base == parent.bufferBase)
            parent = parent.parent;
        return new Stack(this.p, this.stack.slice(), this.state, this.reducePos, this.pos, this.score, buffer, base, this.curContext, this.lookAhead, parent);
    }
    // Try to recover from an error by 'deleting' (ignoring) one token.
    /**
    @internal
    */
    recoverByDelete(next, nextEnd) {
        let isNode = next <= this.p.parser.maxNode;
        if (isNode)
            this.storeNode(next, this.pos, nextEnd, 4);
        this.storeNode(0 /* Term.Err */, this.pos, nextEnd, isNode ? 8 : 4);
        this.pos = this.reducePos = nextEnd;
        this.score -= 190 /* Recover.Delete */;
    }
    /**
    Check if the given term would be able to be shifted (optionally
    after some reductions) on this stack. This can be useful for
    external tokenizers that want to make sure they only provide a
    given token when it applies.
    */
    canShift(term) {
        for (let sim = new SimulatedStack(this);;) {
            let action = this.p.parser.stateSlot(sim.state, 4 /* ParseState.DefaultReduce */) || this.p.parser.hasAction(sim.state, term);
            if (action == 0)
                return false;
            if ((action & 65536 /* Action.ReduceFlag */) == 0)
                return true;
            sim.reduce(action);
        }
    }
    // Apply up to Recover.MaxNext recovery actions that conceptually
    // inserts some missing token or rule.
    /**
    @internal
    */
    recoverByInsert(next) {
        if (this.stack.length >= 300 /* Recover.MaxInsertStackDepth */)
            return [];
        let nextStates = this.p.parser.nextStates(this.state);
        if (nextStates.length > 4 /* Recover.MaxNext */ << 1 || this.stack.length >= 120 /* Recover.DampenInsertStackDepth */) {
            let best = [];
            for (let i = 0, s; i < nextStates.length; i += 2) {
                if ((s = nextStates[i + 1]) != this.state && this.p.parser.hasAction(s, next))
                    best.push(nextStates[i], s);
            }
            if (this.stack.length < 120 /* Recover.DampenInsertStackDepth */)
                for (let i = 0; best.length < 4 /* Recover.MaxNext */ << 1 && i < nextStates.length; i += 2) {
                    let s = nextStates[i + 1];
                    if (!best.some((v, i) => (i & 1) && v == s))
                        best.push(nextStates[i], s);
                }
            nextStates = best;
        }
        let result = [];
        for (let i = 0; i < nextStates.length && result.length < 4 /* Recover.MaxNext */; i += 2) {
            let s = nextStates[i + 1];
            if (s == this.state)
                continue;
            let stack = this.split();
            stack.pushState(s, this.pos);
            stack.storeNode(0 /* Term.Err */, stack.pos, stack.pos, 4, true);
            stack.shiftContext(nextStates[i], this.pos);
            stack.reducePos = this.pos;
            stack.score -= 200 /* Recover.Insert */;
            result.push(stack);
        }
        return result;
    }
    // Force a reduce, if possible. Return false if that can't
    // be done.
    /**
    @internal
    */
    forceReduce() {
        let { parser } = this.p;
        let reduce = parser.stateSlot(this.state, 5 /* ParseState.ForcedReduce */);
        if ((reduce & 65536 /* Action.ReduceFlag */) == 0)
            return false;
        if (!parser.validAction(this.state, reduce)) {
            let depth = reduce >> 19 /* Action.ReduceDepthShift */, term = reduce & 65535 /* Action.ValueMask */;
            let target = this.stack.length - depth * 3;
            if (target < 0 || parser.getGoto(this.stack[target], term, false) < 0) {
                let backup = this.findForcedReduction();
                if (backup == null)
                    return false;
                reduce = backup;
            }
            this.storeNode(0 /* Term.Err */, this.pos, this.pos, 4, true);
            this.score -= 100 /* Recover.Reduce */;
        }
        this.reducePos = this.pos;
        this.reduce(reduce);
        return true;
    }
    /**
    Try to scan through the automaton to find some kind of reduction
    that can be applied. Used when the regular ForcedReduce field
    isn't a valid action. @internal
    */
    findForcedReduction() {
        let { parser } = this.p, seen = [];
        let explore = (state, depth) => {
            if (seen.includes(state))
                return;
            seen.push(state);
            return parser.allActions(state, (action) => {
                if (action & (262144 /* Action.StayFlag */ | 131072 /* Action.GotoFlag */)) ;
                else if (action & 65536 /* Action.ReduceFlag */) {
                    let rDepth = (action >> 19 /* Action.ReduceDepthShift */) - depth;
                    if (rDepth > 1) {
                        let term = action & 65535 /* Action.ValueMask */, target = this.stack.length - rDepth * 3;
                        if (target >= 0 && parser.getGoto(this.stack[target], term, false) >= 0)
                            return (rDepth << 19 /* Action.ReduceDepthShift */) | 65536 /* Action.ReduceFlag */ | term;
                    }
                }
                else {
                    let found = explore(action, depth + 1);
                    if (found != null)
                        return found;
                }
            });
        };
        return explore(this.state, 0);
    }
    /**
    @internal
    */
    forceAll() {
        while (!this.p.parser.stateFlag(this.state, 2 /* StateFlag.Accepting */)) {
            if (!this.forceReduce()) {
                this.storeNode(0 /* Term.Err */, this.pos, this.pos, 4, true);
                break;
            }
        }
        return this;
    }
    /**
    Check whether this state has no further actions (assumed to be a direct descendant of the
    top state, since any other states must be able to continue
    somehow). @internal
    */
    get deadEnd() {
        if (this.stack.length != 3)
            return false;
        let { parser } = this.p;
        return parser.data[parser.stateSlot(this.state, 1 /* ParseState.Actions */)] == 65535 /* Seq.End */ &&
            !parser.stateSlot(this.state, 4 /* ParseState.DefaultReduce */);
    }
    /**
    Restart the stack (put it back in its start state). Only safe
    when this.stack.length == 3 (state is directly below the top
    state). @internal
    */
    restart() {
        this.storeNode(0 /* Term.Err */, this.pos, this.pos, 4, true);
        this.state = this.stack[0];
        this.stack.length = 0;
    }
    /**
    @internal
    */
    sameState(other) {
        if (this.state != other.state || this.stack.length != other.stack.length)
            return false;
        for (let i = 0; i < this.stack.length; i += 3)
            if (this.stack[i] != other.stack[i])
                return false;
        return true;
    }
    /**
    Get the parser used by this stack.
    */
    get parser() { return this.p.parser; }
    /**
    Test whether a given dialect (by numeric ID, as exported from
    the terms file) is enabled.
    */
    dialectEnabled(dialectID) { return this.p.parser.dialect.flags[dialectID]; }
    shiftContext(term, start) {
        if (this.curContext)
            this.updateContext(this.curContext.tracker.shift(this.curContext.context, term, this, this.p.stream.reset(start)));
    }
    reduceContext(term, start) {
        if (this.curContext)
            this.updateContext(this.curContext.tracker.reduce(this.curContext.context, term, this, this.p.stream.reset(start)));
    }
    /**
    @internal
    */
    emitContext() {
        let last = this.buffer.length - 1;
        if (last < 0 || this.buffer[last] != -3)
            this.buffer.push(this.curContext.hash, this.pos, this.pos, -3);
    }
    /**
    @internal
    */
    emitLookAhead() {
        let last = this.buffer.length - 1;
        if (last < 0 || this.buffer[last] != -4)
            this.buffer.push(this.lookAhead, this.pos, this.pos, -4);
    }
    updateContext(context) {
        if (context != this.curContext.context) {
            let newCx = new StackContext(this.curContext.tracker, context);
            if (newCx.hash != this.curContext.hash)
                this.emitContext();
            this.curContext = newCx;
        }
    }
    /**
    @internal
    */
    setLookAhead(lookAhead) {
        if (lookAhead > this.lookAhead) {
            this.emitLookAhead();
            this.lookAhead = lookAhead;
        }
    }
    /**
    @internal
    */
    close() {
        if (this.curContext && this.curContext.tracker.strict)
            this.emitContext();
        if (this.lookAhead > 0)
            this.emitLookAhead();
    }
}
class StackContext {
    constructor(tracker, context) {
        this.tracker = tracker;
        this.context = context;
        this.hash = tracker.strict ? tracker.hash(context) : 0;
    }
}
// Used to cheaply run some reductions to scan ahead without mutating
// an entire stack
class SimulatedStack {
    constructor(start) {
        this.start = start;
        this.state = start.state;
        this.stack = start.stack;
        this.base = this.stack.length;
    }
    reduce(action) {
        let term = action & 65535 /* Action.ValueMask */, depth = action >> 19 /* Action.ReduceDepthShift */;
        if (depth == 0) {
            if (this.stack == this.start.stack)
                this.stack = this.stack.slice();
            this.stack.push(this.state, 0, 0);
            this.base += 3;
        }
        else {
            this.base -= (depth - 1) * 3;
        }
        let goto = this.start.p.parser.getGoto(this.stack[this.base - 3], term, true);
        this.state = goto;
    }
}
// This is given to `Tree.build` to build a buffer, and encapsulates
// the parent-stack-walking necessary to read the nodes.
class StackBufferCursor {
    constructor(stack, pos, index) {
        this.stack = stack;
        this.pos = pos;
        this.index = index;
        this.buffer = stack.buffer;
        if (this.index == 0)
            this.maybeNext();
    }
    static create(stack, pos = stack.bufferBase + stack.buffer.length) {
        return new StackBufferCursor(stack, pos, pos - stack.bufferBase);
    }
    maybeNext() {
        let next = this.stack.parent;
        if (next != null) {
            this.index = this.stack.bufferBase - next.bufferBase;
            this.stack = next;
            this.buffer = next.buffer;
        }
    }
    get id() { return this.buffer[this.index - 4]; }
    get start() { return this.buffer[this.index - 3]; }
    get end() { return this.buffer[this.index - 2]; }
    get size() { return this.buffer[this.index - 1]; }
    next() {
        this.index -= 4;
        this.pos -= 4;
        if (this.index == 0)
            this.maybeNext();
    }
    fork() {
        return new StackBufferCursor(this.stack, this.pos, this.index);
    }
}

// See lezer-generator/src/encode.ts for comments about the encoding
// used here
function decodeArray(input, Type = Uint16Array) {
    if (typeof input != "string")
        return input;
    let array = null;
    for (let pos = 0, out = 0; pos < input.length;) {
        let value = 0;
        for (;;) {
            let next = input.charCodeAt(pos++), stop = false;
            if (next == 126 /* Encode.BigValCode */) {
                value = 65535 /* Encode.BigVal */;
                break;
            }
            if (next >= 92 /* Encode.Gap2 */)
                next--;
            if (next >= 34 /* Encode.Gap1 */)
                next--;
            let digit = next - 32 /* Encode.Start */;
            if (digit >= 46 /* Encode.Base */) {
                digit -= 46 /* Encode.Base */;
                stop = true;
            }
            value += digit;
            if (stop)
                break;
            value *= 46 /* Encode.Base */;
        }
        if (array)
            array[out++] = value;
        else
            array = new Type(value);
    }
    return array;
}

class CachedToken {
    constructor() {
        this.start = -1;
        this.value = -1;
        this.end = -1;
        this.extended = -1;
        this.lookAhead = 0;
        this.mask = 0;
        this.context = 0;
    }
}
const nullToken = new CachedToken;
/**
[Tokenizers](#lr.ExternalTokenizer) interact with the input
through this interface. It presents the input as a stream of
characters, tracking lookahead and hiding the complexity of
[ranges](#common.Parser.parse^ranges) from tokenizer code.
*/
class InputStream {
    /**
    @internal
    */
    constructor(
    /**
    @internal
    */
    input, 
    /**
    @internal
    */
    ranges) {
        this.input = input;
        this.ranges = ranges;
        /**
        @internal
        */
        this.chunk = "";
        /**
        @internal
        */
        this.chunkOff = 0;
        /**
        Backup chunk
        */
        this.chunk2 = "";
        this.chunk2Pos = 0;
        /**
        The character code of the next code unit in the input, or -1
        when the stream is at the end of the input.
        */
        this.next = -1;
        /**
        @internal
        */
        this.token = nullToken;
        this.rangeIndex = 0;
        this.pos = this.chunkPos = ranges[0].from;
        this.range = ranges[0];
        this.end = ranges[ranges.length - 1].to;
        this.readNext();
    }
    /**
    @internal
    */
    resolveOffset(offset, assoc) {
        let range = this.range, index = this.rangeIndex;
        let pos = this.pos + offset;
        while (pos < range.from) {
            if (!index)
                return null;
            let next = this.ranges[--index];
            pos -= range.from - next.to;
            range = next;
        }
        while (assoc < 0 ? pos > range.to : pos >= range.to) {
            if (index == this.ranges.length - 1)
                return null;
            let next = this.ranges[++index];
            pos += next.from - range.to;
            range = next;
        }
        return pos;
    }
    /**
    @internal
    */
    clipPos(pos) {
        if (pos >= this.range.from && pos < this.range.to)
            return pos;
        for (let range of this.ranges)
            if (range.to > pos)
                return Math.max(pos, range.from);
        return this.end;
    }
    /**
    Look at a code unit near the stream position. `.peek(0)` equals
    `.next`, `.peek(-1)` gives you the previous character, and so
    on.
    
    Note that looking around during tokenizing creates dependencies
    on potentially far-away content, which may reduce the
    effectiveness incremental parsing—when looking forward—or even
    cause invalid reparses when looking backward more than 25 code
    units, since the library does not track lookbehind.
    */
    peek(offset) {
        let idx = this.chunkOff + offset, pos, result;
        if (idx >= 0 && idx < this.chunk.length) {
            pos = this.pos + offset;
            result = this.chunk.charCodeAt(idx);
        }
        else {
            let resolved = this.resolveOffset(offset, 1);
            if (resolved == null)
                return -1;
            pos = resolved;
            if (pos >= this.chunk2Pos && pos < this.chunk2Pos + this.chunk2.length) {
                result = this.chunk2.charCodeAt(pos - this.chunk2Pos);
            }
            else {
                let i = this.rangeIndex, range = this.range;
                while (range.to <= pos)
                    range = this.ranges[++i];
                this.chunk2 = this.input.chunk(this.chunk2Pos = pos);
                if (pos + this.chunk2.length > range.to)
                    this.chunk2 = this.chunk2.slice(0, range.to - pos);
                result = this.chunk2.charCodeAt(0);
            }
        }
        if (pos >= this.token.lookAhead)
            this.token.lookAhead = pos + 1;
        return result;
    }
    /**
    Accept a token. By default, the end of the token is set to the
    current stream position, but you can pass an offset (relative to
    the stream position) to change that.
    */
    acceptToken(token, endOffset = 0) {
        let end = endOffset ? this.resolveOffset(endOffset, -1) : this.pos;
        if (end == null || end < this.token.start)
            throw new RangeError("Token end out of bounds");
        this.token.value = token;
        this.token.end = end;
    }
    /**
    Accept a token ending at a specific given position.
    */
    acceptTokenTo(token, endPos) {
        this.token.value = token;
        this.token.end = endPos;
    }
    getChunk() {
        if (this.pos >= this.chunk2Pos && this.pos < this.chunk2Pos + this.chunk2.length) {
            let { chunk, chunkPos } = this;
            this.chunk = this.chunk2;
            this.chunkPos = this.chunk2Pos;
            this.chunk2 = chunk;
            this.chunk2Pos = chunkPos;
            this.chunkOff = this.pos - this.chunkPos;
        }
        else {
            this.chunk2 = this.chunk;
            this.chunk2Pos = this.chunkPos;
            let nextChunk = this.input.chunk(this.pos);
            let end = this.pos + nextChunk.length;
            this.chunk = end > this.range.to ? nextChunk.slice(0, this.range.to - this.pos) : nextChunk;
            this.chunkPos = this.pos;
            this.chunkOff = 0;
        }
    }
    readNext() {
        if (this.chunkOff >= this.chunk.length) {
            this.getChunk();
            if (this.chunkOff == this.chunk.length)
                return this.next = -1;
        }
        return this.next = this.chunk.charCodeAt(this.chunkOff);
    }
    /**
    Move the stream forward N (defaults to 1) code units. Returns
    the new value of [`next`](#lr.InputStream.next).
    */
    advance(n = 1) {
        this.chunkOff += n;
        while (this.pos + n >= this.range.to) {
            if (this.rangeIndex == this.ranges.length - 1)
                return this.setDone();
            n -= this.range.to - this.pos;
            this.range = this.ranges[++this.rangeIndex];
            this.pos = this.range.from;
        }
        this.pos += n;
        if (this.pos >= this.token.lookAhead)
            this.token.lookAhead = this.pos + 1;
        return this.readNext();
    }
    setDone() {
        this.pos = this.chunkPos = this.end;
        this.range = this.ranges[this.rangeIndex = this.ranges.length - 1];
        this.chunk = "";
        return this.next = -1;
    }
    /**
    @internal
    */
    reset(pos, token) {
        if (token) {
            this.token = token;
            token.start = pos;
            token.lookAhead = pos + 1;
            token.value = token.extended = -1;
        }
        else {
            this.token = nullToken;
        }
        if (this.pos != pos) {
            this.pos = pos;
            if (pos == this.end) {
                this.setDone();
                return this;
            }
            while (pos < this.range.from)
                this.range = this.ranges[--this.rangeIndex];
            while (pos >= this.range.to)
                this.range = this.ranges[++this.rangeIndex];
            if (pos >= this.chunkPos && pos < this.chunkPos + this.chunk.length) {
                this.chunkOff = pos - this.chunkPos;
            }
            else {
                this.chunk = "";
                this.chunkOff = 0;
            }
            this.readNext();
        }
        return this;
    }
    /**
    @internal
    */
    read(from, to) {
        if (from >= this.chunkPos && to <= this.chunkPos + this.chunk.length)
            return this.chunk.slice(from - this.chunkPos, to - this.chunkPos);
        if (from >= this.chunk2Pos && to <= this.chunk2Pos + this.chunk2.length)
            return this.chunk2.slice(from - this.chunk2Pos, to - this.chunk2Pos);
        if (from >= this.range.from && to <= this.range.to)
            return this.input.read(from, to);
        let result = "";
        for (let r of this.ranges) {
            if (r.from >= to)
                break;
            if (r.to > from)
                result += this.input.read(Math.max(r.from, from), Math.min(r.to, to));
        }
        return result;
    }
}
/**
@internal
*/
class TokenGroup {
    constructor(data, id) {
        this.data = data;
        this.id = id;
    }
    token(input, stack) {
        let { parser } = stack.p;
        readToken(this.data, input, stack, this.id, parser.data, parser.tokenPrecTable);
    }
}
TokenGroup.prototype.contextual = TokenGroup.prototype.fallback = TokenGroup.prototype.extend = false;
/**
@hide
*/
class LocalTokenGroup {
    constructor(data, precTable, elseToken) {
        this.precTable = precTable;
        this.elseToken = elseToken;
        this.data = typeof data == "string" ? decodeArray(data) : data;
    }
    token(input, stack) {
        let start = input.pos, skipped = 0;
        for (;;) {
            let atEof = input.next < 0, nextPos = input.resolveOffset(1, 1);
            readToken(this.data, input, stack, 0, this.data, this.precTable);
            if (input.token.value > -1)
                break;
            if (this.elseToken == null)
                return;
            if (!atEof)
                skipped++;
            if (nextPos == null)
                break;
            input.reset(nextPos, input.token);
        }
        if (skipped) {
            input.reset(start, input.token);
            input.acceptToken(this.elseToken, skipped);
        }
    }
}
LocalTokenGroup.prototype.contextual = TokenGroup.prototype.fallback = TokenGroup.prototype.extend = false;
/**
`@external tokens` declarations in the grammar should resolve to
an instance of this class.
*/
class ExternalTokenizer {
    /**
    Create a tokenizer. The first argument is the function that,
    given an input stream, scans for the types of tokens it
    recognizes at the stream's position, and calls
    [`acceptToken`](#lr.InputStream.acceptToken) when it finds
    one.
    */
    constructor(
    /**
    @internal
    */
    token, options = {}) {
        this.token = token;
        this.contextual = !!options.contextual;
        this.fallback = !!options.fallback;
        this.extend = !!options.extend;
    }
}
// Tokenizer data is stored a big uint16 array containing, for each
// state:
//
//  - A group bitmask, indicating what token groups are reachable from
//    this state, so that paths that can only lead to tokens not in
//    any of the current groups can be cut off early.
//
//  - The position of the end of the state's sequence of accepting
//    tokens
//
//  - The number of outgoing edges for the state
//
//  - The accepting tokens, as (token id, group mask) pairs
//
//  - The outgoing edges, as (start character, end character, state
//    index) triples, with end character being exclusive
//
// This function interprets that data, running through a stream as
// long as new states with the a matching group mask can be reached,
// and updating `input.token` when it matches a token.
function readToken(data, input, stack, group, precTable, precOffset) {
    let state = 0, groupMask = 1 << group, { dialect } = stack.p.parser;
    scan: for (;;) {
        if ((groupMask & data[state]) == 0)
            break;
        let accEnd = data[state + 1];
        // Check whether this state can lead to a token in the current group
        // Accept tokens in this state, possibly overwriting
        // lower-precedence / shorter tokens
        for (let i = state + 3; i < accEnd; i += 2)
            if ((data[i + 1] & groupMask) > 0) {
                let term = data[i];
                if (dialect.allows(term) &&
                    (input.token.value == -1 || input.token.value == term ||
                        overrides(term, input.token.value, precTable, precOffset))) {
                    input.acceptToken(term);
                    break;
                }
            }
        let next = input.next, low = 0, high = data[state + 2];
        // Special case for EOF
        if (input.next < 0 && high > low && data[accEnd + high * 3 - 3] == 65535 /* Seq.End */) {
            state = data[accEnd + high * 3 - 1];
            continue scan;
        }
        // Do a binary search on the state's edges
        for (; low < high;) {
            let mid = (low + high) >> 1;
            let index = accEnd + mid + (mid << 1);
            let from = data[index], to = data[index + 1] || 0x10000;
            if (next < from)
                high = mid;
            else if (next >= to)
                low = mid + 1;
            else {
                state = data[index + 2];
                input.advance();
                continue scan;
            }
        }
        break;
    }
}
function findOffset(data, start, term) {
    for (let i = start, next; (next = data[i]) != 65535 /* Seq.End */; i++)
        if (next == term)
            return i - start;
    return -1;
}
function overrides(token, prev, tableData, tableOffset) {
    let iPrev = findOffset(tableData, tableOffset, prev);
    return iPrev < 0 || findOffset(tableData, tableOffset, token) < iPrev;
}

// Environment variable used to control console output
const verbose = typeof process != "undefined" && process.env && /\bparse\b/.test(process.env.LOG);
let stackIDs = null;
function cutAt(tree, pos, side) {
    let cursor = tree.cursor(IterMode.IncludeAnonymous);
    cursor.moveTo(pos);
    for (;;) {
        if (!(side < 0 ? cursor.childBefore(pos) : cursor.childAfter(pos)))
            for (;;) {
                if ((side < 0 ? cursor.to < pos : cursor.from > pos) && !cursor.type.isError)
                    return side < 0 ? Math.max(0, Math.min(cursor.to - 1, pos - 25 /* Lookahead.Margin */))
                        : Math.min(tree.length, Math.max(cursor.from + 1, pos + 25 /* Lookahead.Margin */));
                if (side < 0 ? cursor.prevSibling() : cursor.nextSibling())
                    break;
                if (!cursor.parent())
                    return side < 0 ? 0 : tree.length;
            }
    }
}
class FragmentCursor {
    constructor(fragments, nodeSet) {
        this.fragments = fragments;
        this.nodeSet = nodeSet;
        this.i = 0;
        this.fragment = null;
        this.safeFrom = -1;
        this.safeTo = -1;
        this.trees = [];
        this.start = [];
        this.index = [];
        this.nextFragment();
    }
    nextFragment() {
        let fr = this.fragment = this.i == this.fragments.length ? null : this.fragments[this.i++];
        if (fr) {
            this.safeFrom = fr.openStart ? cutAt(fr.tree, fr.from + fr.offset, 1) - fr.offset : fr.from;
            this.safeTo = fr.openEnd ? cutAt(fr.tree, fr.to + fr.offset, -1) - fr.offset : fr.to;
            while (this.trees.length) {
                this.trees.pop();
                this.start.pop();
                this.index.pop();
            }
            this.trees.push(fr.tree);
            this.start.push(-fr.offset);
            this.index.push(0);
            this.nextStart = this.safeFrom;
        }
        else {
            this.nextStart = 1e9;
        }
    }
    // `pos` must be >= any previously given `pos` for this cursor
    nodeAt(pos) {
        if (pos < this.nextStart)
            return null;
        while (this.fragment && this.safeTo <= pos)
            this.nextFragment();
        if (!this.fragment)
            return null;
        for (;;) {
            let last = this.trees.length - 1;
            if (last < 0) { // End of tree
                this.nextFragment();
                return null;
            }
            let top = this.trees[last], index = this.index[last];
            if (index == top.children.length) {
                this.trees.pop();
                this.start.pop();
                this.index.pop();
                continue;
            }
            let next = top.children[index];
            let start = this.start[last] + top.positions[index];
            if (start > pos) {
                this.nextStart = start;
                return null;
            }
            if (next instanceof Tree) {
                if (start == pos) {
                    if (start < this.safeFrom)
                        return null;
                    let end = start + next.length;
                    if (end <= this.safeTo) {
                        let lookAhead = next.prop(NodeProp.lookAhead);
                        if (!lookAhead || end + lookAhead < this.fragment.to)
                            return next;
                    }
                }
                this.index[last]++;
                if (start + next.length >= Math.max(this.safeFrom, pos)) { // Enter this node
                    this.trees.push(next);
                    this.start.push(start);
                    this.index.push(0);
                }
            }
            else {
                this.index[last]++;
                this.nextStart = start + next.length;
            }
        }
    }
}
class TokenCache {
    constructor(parser, stream) {
        this.stream = stream;
        this.tokens = [];
        this.mainToken = null;
        this.actions = [];
        this.tokens = parser.tokenizers.map(_ => new CachedToken);
    }
    getActions(stack) {
        let actionIndex = 0;
        let main = null;
        let { parser } = stack.p, { tokenizers } = parser;
        let mask = parser.stateSlot(stack.state, 3 /* ParseState.TokenizerMask */);
        let context = stack.curContext ? stack.curContext.hash : 0;
        let lookAhead = 0;
        for (let i = 0; i < tokenizers.length; i++) {
            if (((1 << i) & mask) == 0)
                continue;
            let tokenizer = tokenizers[i], token = this.tokens[i];
            if (main && !tokenizer.fallback)
                continue;
            if (tokenizer.contextual || token.start != stack.pos || token.mask != mask || token.context != context) {
                this.updateCachedToken(token, tokenizer, stack);
                token.mask = mask;
                token.context = context;
            }
            if (token.lookAhead > token.end + 25 /* Lookahead.Margin */)
                lookAhead = Math.max(token.lookAhead, lookAhead);
            if (token.value != 0 /* Term.Err */) {
                let startIndex = actionIndex;
                if (token.extended > -1)
                    actionIndex = this.addActions(stack, token.extended, token.end, actionIndex);
                actionIndex = this.addActions(stack, token.value, token.end, actionIndex);
                if (!tokenizer.extend) {
                    main = token;
                    if (actionIndex > startIndex)
                        break;
                }
            }
        }
        while (this.actions.length > actionIndex)
            this.actions.pop();
        if (lookAhead)
            stack.setLookAhead(lookAhead);
        if (!main && stack.pos == this.stream.end) {
            main = new CachedToken;
            main.value = stack.p.parser.eofTerm;
            main.start = main.end = stack.pos;
            actionIndex = this.addActions(stack, main.value, main.end, actionIndex);
        }
        this.mainToken = main;
        return this.actions;
    }
    getMainToken(stack) {
        if (this.mainToken)
            return this.mainToken;
        let main = new CachedToken, { pos, p } = stack;
        main.start = pos;
        main.end = Math.min(pos + 1, p.stream.end);
        main.value = pos == p.stream.end ? p.parser.eofTerm : 0 /* Term.Err */;
        return main;
    }
    updateCachedToken(token, tokenizer, stack) {
        let start = this.stream.clipPos(stack.pos);
        tokenizer.token(this.stream.reset(start, token), stack);
        if (token.value > -1) {
            let { parser } = stack.p;
            for (let i = 0; i < parser.specialized.length; i++)
                if (parser.specialized[i] == token.value) {
                    let result = parser.specializers[i](this.stream.read(token.start, token.end), stack);
                    if (result >= 0 && stack.p.parser.dialect.allows(result >> 1)) {
                        if ((result & 1) == 0 /* Specialize.Specialize */)
                            token.value = result >> 1;
                        else
                            token.extended = result >> 1;
                        break;
                    }
                }
        }
        else {
            token.value = 0 /* Term.Err */;
            token.end = this.stream.clipPos(start + 1);
        }
    }
    putAction(action, token, end, index) {
        // Don't add duplicate actions
        for (let i = 0; i < index; i += 3)
            if (this.actions[i] == action)
                return index;
        this.actions[index++] = action;
        this.actions[index++] = token;
        this.actions[index++] = end;
        return index;
    }
    addActions(stack, token, end, index) {
        let { state } = stack, { parser } = stack.p, { data } = parser;
        for (let set = 0; set < 2; set++) {
            for (let i = parser.stateSlot(state, set ? 2 /* ParseState.Skip */ : 1 /* ParseState.Actions */);; i += 3) {
                if (data[i] == 65535 /* Seq.End */) {
                    if (data[i + 1] == 1 /* Seq.Next */) {
                        i = pair(data, i + 2);
                    }
                    else {
                        if (index == 0 && data[i + 1] == 2 /* Seq.Other */)
                            index = this.putAction(pair(data, i + 2), token, end, index);
                        break;
                    }
                }
                if (data[i] == token)
                    index = this.putAction(pair(data, i + 1), token, end, index);
            }
        }
        return index;
    }
}
class Parse {
    constructor(parser, input, fragments, ranges) {
        this.parser = parser;
        this.input = input;
        this.ranges = ranges;
        this.recovering = 0;
        this.nextStackID = 0x2654; // ♔, ♕, ♖, ♗, ♘, ♙, ♠, ♡, ♢, ♣, ♤, ♥, ♦, ♧
        this.minStackPos = 0;
        this.reused = [];
        this.stoppedAt = null;
        this.lastBigReductionStart = -1;
        this.lastBigReductionSize = 0;
        this.bigReductionCount = 0;
        this.stream = new InputStream(input, ranges);
        this.tokens = new TokenCache(parser, this.stream);
        this.topTerm = parser.top[1];
        let { from } = ranges[0];
        this.stacks = [Stack.start(this, parser.top[0], from)];
        this.fragments = fragments.length && this.stream.end - from > parser.bufferLength * 4
            ? new FragmentCursor(fragments, parser.nodeSet) : null;
    }
    get parsedPos() {
        return this.minStackPos;
    }
    // Move the parser forward. This will process all parse stacks at
    // `this.pos` and try to advance them to a further position. If no
    // stack for such a position is found, it'll start error-recovery.
    //
    // When the parse is finished, this will return a syntax tree. When
    // not, it returns `null`.
    advance() {
        let stacks = this.stacks, pos = this.minStackPos;
        // This will hold stacks beyond `pos`.
        let newStacks = this.stacks = [];
        let stopped, stoppedTokens;
        // If a large amount of reductions happened with the same start
        // position, force the stack out of that production in order to
        // avoid creating a tree too deep to recurse through.
        // (This is an ugly kludge, because unfortunately there is no
        // straightforward, cheap way to check for this happening, due to
        // the history of reductions only being available in an
        // expensive-to-access format in the stack buffers.)
        if (this.bigReductionCount > 300 /* Rec.MaxLeftAssociativeReductionCount */ && stacks.length == 1) {
            let [s] = stacks;
            while (s.forceReduce() && s.stack.length && s.stack[s.stack.length - 2] >= this.lastBigReductionStart) { }
            this.bigReductionCount = this.lastBigReductionSize = 0;
        }
        // Keep advancing any stacks at `pos` until they either move
        // forward or can't be advanced. Gather stacks that can't be
        // advanced further in `stopped`.
        for (let i = 0; i < stacks.length; i++) {
            let stack = stacks[i];
            for (;;) {
                this.tokens.mainToken = null;
                if (stack.pos > pos) {
                    newStacks.push(stack);
                }
                else if (this.advanceStack(stack, newStacks, stacks)) {
                    continue;
                }
                else {
                    if (!stopped) {
                        stopped = [];
                        stoppedTokens = [];
                    }
                    stopped.push(stack);
                    let tok = this.tokens.getMainToken(stack);
                    stoppedTokens.push(tok.value, tok.end);
                }
                break;
            }
        }
        if (!newStacks.length) {
            let finished = stopped && findFinished(stopped);
            if (finished) {
                if (verbose)
                    console.log("Finish with " + this.stackID(finished));
                return this.stackToTree(finished);
            }
            if (this.parser.strict) {
                if (verbose && stopped)
                    console.log("Stuck with token " + (this.tokens.mainToken ? this.parser.getName(this.tokens.mainToken.value) : "none"));
                throw new SyntaxError("No parse at " + pos);
            }
            if (!this.recovering)
                this.recovering = 5 /* Rec.Distance */;
        }
        if (this.recovering && stopped) {
            let finished = this.stoppedAt != null && stopped[0].pos > this.stoppedAt ? stopped[0]
                : this.runRecovery(stopped, stoppedTokens, newStacks);
            if (finished) {
                if (verbose)
                    console.log("Force-finish " + this.stackID(finished));
                return this.stackToTree(finished.forceAll());
            }
        }
        if (this.recovering) {
            let maxRemaining = this.recovering == 1 ? 1 : this.recovering * 3 /* Rec.MaxRemainingPerStep */;
            if (newStacks.length > maxRemaining) {
                newStacks.sort((a, b) => b.score - a.score);
                while (newStacks.length > maxRemaining)
                    newStacks.pop();
            }
            if (newStacks.some(s => s.reducePos > pos))
                this.recovering--;
        }
        else if (newStacks.length > 1) {
            // Prune stacks that are in the same state, or that have been
            // running without splitting for a while, to avoid getting stuck
            // with multiple successful stacks running endlessly on.
            outer: for (let i = 0; i < newStacks.length - 1; i++) {
                let stack = newStacks[i];
                for (let j = i + 1; j < newStacks.length; j++) {
                    let other = newStacks[j];
                    if (stack.sameState(other) ||
                        stack.buffer.length > 500 /* Rec.MinBufferLengthPrune */ && other.buffer.length > 500 /* Rec.MinBufferLengthPrune */) {
                        if (((stack.score - other.score) || (stack.buffer.length - other.buffer.length)) > 0) {
                            newStacks.splice(j--, 1);
                        }
                        else {
                            newStacks.splice(i--, 1);
                            continue outer;
                        }
                    }
                }
            }
            if (newStacks.length > 12 /* Rec.MaxStackCount */)
                newStacks.splice(12 /* Rec.MaxStackCount */, newStacks.length - 12 /* Rec.MaxStackCount */);
        }
        this.minStackPos = newStacks[0].pos;
        for (let i = 1; i < newStacks.length; i++)
            if (newStacks[i].pos < this.minStackPos)
                this.minStackPos = newStacks[i].pos;
        return null;
    }
    stopAt(pos) {
        if (this.stoppedAt != null && this.stoppedAt < pos)
            throw new RangeError("Can't move stoppedAt forward");
        this.stoppedAt = pos;
    }
    // Returns an updated version of the given stack, or null if the
    // stack can't advance normally. When `split` and `stacks` are
    // given, stacks split off by ambiguous operations will be pushed to
    // `split`, or added to `stacks` if they move `pos` forward.
    advanceStack(stack, stacks, split) {
        let start = stack.pos, { parser } = this;
        let base = verbose ? this.stackID(stack) + " -> " : "";
        if (this.stoppedAt != null && start > this.stoppedAt)
            return stack.forceReduce() ? stack : null;
        if (this.fragments) {
            let strictCx = stack.curContext && stack.curContext.tracker.strict, cxHash = strictCx ? stack.curContext.hash : 0;
            for (let cached = this.fragments.nodeAt(start); cached;) {
                let match = this.parser.nodeSet.types[cached.type.id] == cached.type ? parser.getGoto(stack.state, cached.type.id) : -1;
                if (match > -1 && cached.length && (!strictCx || (cached.prop(NodeProp.contextHash) || 0) == cxHash)) {
                    stack.useNode(cached, match);
                    if (verbose)
                        console.log(base + this.stackID(stack) + ` (via reuse of ${parser.getName(cached.type.id)})`);
                    return true;
                }
                if (!(cached instanceof Tree) || cached.children.length == 0 || cached.positions[0] > 0)
                    break;
                let inner = cached.children[0];
                if (inner instanceof Tree && cached.positions[0] == 0)
                    cached = inner;
                else
                    break;
            }
        }
        let defaultReduce = parser.stateSlot(stack.state, 4 /* ParseState.DefaultReduce */);
        if (defaultReduce > 0) {
            stack.reduce(defaultReduce);
            if (verbose)
                console.log(base + this.stackID(stack) + ` (via always-reduce ${parser.getName(defaultReduce & 65535 /* Action.ValueMask */)})`);
            return true;
        }
        if (stack.stack.length >= 8400 /* Rec.CutDepth */) {
            while (stack.stack.length > 6000 /* Rec.CutTo */ && stack.forceReduce()) { }
        }
        let actions = this.tokens.getActions(stack);
        for (let i = 0; i < actions.length;) {
            let action = actions[i++], term = actions[i++], end = actions[i++];
            let last = i == actions.length || !split;
            let localStack = last ? stack : stack.split();
            let main = this.tokens.mainToken;
            localStack.apply(action, term, main ? main.start : localStack.pos, end);
            if (verbose)
                console.log(base + this.stackID(localStack) + ` (via ${(action & 65536 /* Action.ReduceFlag */) == 0 ? "shift"
                    : `reduce of ${parser.getName(action & 65535 /* Action.ValueMask */)}`} for ${parser.getName(term)} @ ${start}${localStack == stack ? "" : ", split"})`);
            if (last)
                return true;
            else if (localStack.pos > start)
                stacks.push(localStack);
            else
                split.push(localStack);
        }
        return false;
    }
    // Advance a given stack forward as far as it will go. Returns the
    // (possibly updated) stack if it got stuck, or null if it moved
    // forward and was given to `pushStackDedup`.
    advanceFully(stack, newStacks) {
        let pos = stack.pos;
        for (;;) {
            if (!this.advanceStack(stack, null, null))
                return false;
            if (stack.pos > pos) {
                pushStackDedup(stack, newStacks);
                return true;
            }
        }
    }
    runRecovery(stacks, tokens, newStacks) {
        let finished = null, restarted = false;
        for (let i = 0; i < stacks.length; i++) {
            let stack = stacks[i], token = tokens[i << 1], tokenEnd = tokens[(i << 1) + 1];
            let base = verbose ? this.stackID(stack) + " -> " : "";
            if (stack.deadEnd) {
                if (restarted)
                    continue;
                restarted = true;
                stack.restart();
                if (verbose)
                    console.log(base + this.stackID(stack) + " (restarted)");
                let done = this.advanceFully(stack, newStacks);
                if (done)
                    continue;
            }
            let force = stack.split(), forceBase = base;
            for (let j = 0; force.forceReduce() && j < 10 /* Rec.ForceReduceLimit */; j++) {
                if (verbose)
                    console.log(forceBase + this.stackID(force) + " (via force-reduce)");
                let done = this.advanceFully(force, newStacks);
                if (done)
                    break;
                if (verbose)
                    forceBase = this.stackID(force) + " -> ";
            }
            for (let insert of stack.recoverByInsert(token)) {
                if (verbose)
                    console.log(base + this.stackID(insert) + " (via recover-insert)");
                this.advanceFully(insert, newStacks);
            }
            if (this.stream.end > stack.pos) {
                if (tokenEnd == stack.pos) {
                    tokenEnd++;
                    token = 0 /* Term.Err */;
                }
                stack.recoverByDelete(token, tokenEnd);
                if (verbose)
                    console.log(base + this.stackID(stack) + ` (via recover-delete ${this.parser.getName(token)})`);
                pushStackDedup(stack, newStacks);
            }
            else if (!finished || finished.score < stack.score) {
                finished = stack;
            }
        }
        return finished;
    }
    // Convert the stack's buffer to a syntax tree.
    stackToTree(stack) {
        stack.close();
        return Tree.build({ buffer: StackBufferCursor.create(stack),
            nodeSet: this.parser.nodeSet,
            topID: this.topTerm,
            maxBufferLength: this.parser.bufferLength,
            reused: this.reused,
            start: this.ranges[0].from,
            length: stack.pos - this.ranges[0].from,
            minRepeatType: this.parser.minRepeatTerm });
    }
    stackID(stack) {
        let id = (stackIDs || (stackIDs = new WeakMap)).get(stack);
        if (!id)
            stackIDs.set(stack, id = String.fromCodePoint(this.nextStackID++));
        return id + stack;
    }
}
function pushStackDedup(stack, newStacks) {
    for (let i = 0; i < newStacks.length; i++) {
        let other = newStacks[i];
        if (other.pos == stack.pos && other.sameState(stack)) {
            if (newStacks[i].score < stack.score)
                newStacks[i] = stack;
            return;
        }
    }
    newStacks.push(stack);
}
class Dialect {
    constructor(source, flags, disabled) {
        this.source = source;
        this.flags = flags;
        this.disabled = disabled;
    }
    allows(term) { return !this.disabled || this.disabled[term] == 0; }
}
const id = x => x;
/**
Context trackers are used to track stateful context (such as
indentation in the Python grammar, or parent elements in the XML
grammar) needed by external tokenizers. You declare them in a
grammar file as `@context exportName from "module"`.

Context values should be immutable, and can be updated (replaced)
on shift or reduce actions.

The export used in a `@context` declaration should be of this
type.
*/
class ContextTracker {
    /**
    Define a context tracker.
    */
    constructor(spec) {
        this.start = spec.start;
        this.shift = spec.shift || id;
        this.reduce = spec.reduce || id;
        this.reuse = spec.reuse || id;
        this.hash = spec.hash || (() => 0);
        this.strict = spec.strict !== false;
    }
}
/**
Holds the parse tables for a given grammar, as generated by
`lezer-generator`, and provides [methods](#common.Parser) to parse
content with.
*/
class LRParser extends Parser {
    /**
    @internal
    */
    constructor(spec) {
        super();
        /**
        @internal
        */
        this.wrappers = [];
        if (spec.version != 14 /* File.Version */)
            throw new RangeError(`Parser version (${spec.version}) doesn't match runtime version (${14 /* File.Version */})`);
        let nodeNames = spec.nodeNames.split(" ");
        this.minRepeatTerm = nodeNames.length;
        for (let i = 0; i < spec.repeatNodeCount; i++)
            nodeNames.push("");
        let topTerms = Object.keys(spec.topRules).map(r => spec.topRules[r][1]);
        let nodeProps = [];
        for (let i = 0; i < nodeNames.length; i++)
            nodeProps.push([]);
        function setProp(nodeID, prop, value) {
            nodeProps[nodeID].push([prop, prop.deserialize(String(value))]);
        }
        if (spec.nodeProps)
            for (let propSpec of spec.nodeProps) {
                let prop = propSpec[0];
                if (typeof prop == "string")
                    prop = NodeProp[prop];
                for (let i = 1; i < propSpec.length;) {
                    let next = propSpec[i++];
                    if (next >= 0) {
                        setProp(next, prop, propSpec[i++]);
                    }
                    else {
                        let value = propSpec[i + -next];
                        for (let j = -next; j > 0; j--)
                            setProp(propSpec[i++], prop, value);
                        i++;
                    }
                }
            }
        this.nodeSet = new NodeSet(nodeNames.map((name, i) => NodeType.define({
            name: i >= this.minRepeatTerm ? undefined : name,
            id: i,
            props: nodeProps[i],
            top: topTerms.indexOf(i) > -1,
            error: i == 0,
            skipped: spec.skippedNodes && spec.skippedNodes.indexOf(i) > -1
        })));
        if (spec.propSources)
            this.nodeSet = this.nodeSet.extend(...spec.propSources);
        this.strict = false;
        this.bufferLength = DefaultBufferLength;
        let tokenArray = decodeArray(spec.tokenData);
        this.context = spec.context;
        this.specializerSpecs = spec.specialized || [];
        this.specialized = new Uint16Array(this.specializerSpecs.length);
        for (let i = 0; i < this.specializerSpecs.length; i++)
            this.specialized[i] = this.specializerSpecs[i].term;
        this.specializers = this.specializerSpecs.map(getSpecializer);
        this.states = decodeArray(spec.states, Uint32Array);
        this.data = decodeArray(spec.stateData);
        this.goto = decodeArray(spec.goto);
        this.maxTerm = spec.maxTerm;
        this.tokenizers = spec.tokenizers.map(value => typeof value == "number" ? new TokenGroup(tokenArray, value) : value);
        this.topRules = spec.topRules;
        this.dialects = spec.dialects || {};
        this.dynamicPrecedences = spec.dynamicPrecedences || null;
        this.tokenPrecTable = spec.tokenPrec;
        this.termNames = spec.termNames || null;
        this.maxNode = this.nodeSet.types.length - 1;
        this.dialect = this.parseDialect();
        this.top = this.topRules[Object.keys(this.topRules)[0]];
    }
    createParse(input, fragments, ranges) {
        let parse = new Parse(this, input, fragments, ranges);
        for (let w of this.wrappers)
            parse = w(parse, input, fragments, ranges);
        return parse;
    }
    /**
    Get a goto table entry @internal
    */
    getGoto(state, term, loose = false) {
        let table = this.goto;
        if (term >= table[0])
            return -1;
        for (let pos = table[term + 1];;) {
            let groupTag = table[pos++], last = groupTag & 1;
            let target = table[pos++];
            if (last && loose)
                return target;
            for (let end = pos + (groupTag >> 1); pos < end; pos++)
                if (table[pos] == state)
                    return target;
            if (last)
                return -1;
        }
    }
    /**
    Check if this state has an action for a given terminal @internal
    */
    hasAction(state, terminal) {
        let data = this.data;
        for (let set = 0; set < 2; set++) {
            for (let i = this.stateSlot(state, set ? 2 /* ParseState.Skip */ : 1 /* ParseState.Actions */), next;; i += 3) {
                if ((next = data[i]) == 65535 /* Seq.End */) {
                    if (data[i + 1] == 1 /* Seq.Next */)
                        next = data[i = pair(data, i + 2)];
                    else if (data[i + 1] == 2 /* Seq.Other */)
                        return pair(data, i + 2);
                    else
                        break;
                }
                if (next == terminal || next == 0 /* Term.Err */)
                    return pair(data, i + 1);
            }
        }
        return 0;
    }
    /**
    @internal
    */
    stateSlot(state, slot) {
        return this.states[(state * 6 /* ParseState.Size */) + slot];
    }
    /**
    @internal
    */
    stateFlag(state, flag) {
        return (this.stateSlot(state, 0 /* ParseState.Flags */) & flag) > 0;
    }
    /**
    @internal
    */
    validAction(state, action) {
        return !!this.allActions(state, a => a == action ? true : null);
    }
    /**
    @internal
    */
    allActions(state, action) {
        let deflt = this.stateSlot(state, 4 /* ParseState.DefaultReduce */);
        let result = deflt ? action(deflt) : undefined;
        for (let i = this.stateSlot(state, 1 /* ParseState.Actions */); result == null; i += 3) {
            if (this.data[i] == 65535 /* Seq.End */) {
                if (this.data[i + 1] == 1 /* Seq.Next */)
                    i = pair(this.data, i + 2);
                else
                    break;
            }
            result = action(pair(this.data, i + 1));
        }
        return result;
    }
    /**
    Get the states that can follow this one through shift actions or
    goto jumps. @internal
    */
    nextStates(state) {
        let result = [];
        for (let i = this.stateSlot(state, 1 /* ParseState.Actions */);; i += 3) {
            if (this.data[i] == 65535 /* Seq.End */) {
                if (this.data[i + 1] == 1 /* Seq.Next */)
                    i = pair(this.data, i + 2);
                else
                    break;
            }
            if ((this.data[i + 2] & (65536 /* Action.ReduceFlag */ >> 16)) == 0) {
                let value = this.data[i + 1];
                if (!result.some((v, i) => (i & 1) && v == value))
                    result.push(this.data[i], value);
            }
        }
        return result;
    }
    /**
    Configure the parser. Returns a new parser instance that has the
    given settings modified. Settings not provided in `config` are
    kept from the original parser.
    */
    configure(config) {
        // Hideous reflection-based kludge to make it easy to create a
        // slightly modified copy of a parser.
        let copy = Object.assign(Object.create(LRParser.prototype), this);
        if (config.props)
            copy.nodeSet = this.nodeSet.extend(...config.props);
        if (config.top) {
            let info = this.topRules[config.top];
            if (!info)
                throw new RangeError(`Invalid top rule name ${config.top}`);
            copy.top = info;
        }
        if (config.tokenizers)
            copy.tokenizers = this.tokenizers.map(t => {
                let found = config.tokenizers.find(r => r.from == t);
                return found ? found.to : t;
            });
        if (config.specializers) {
            copy.specializers = this.specializers.slice();
            copy.specializerSpecs = this.specializerSpecs.map((s, i) => {
                let found = config.specializers.find(r => r.from == s.external);
                if (!found)
                    return s;
                let spec = Object.assign(Object.assign({}, s), { external: found.to });
                copy.specializers[i] = getSpecializer(spec);
                return spec;
            });
        }
        if (config.contextTracker)
            copy.context = config.contextTracker;
        if (config.dialect)
            copy.dialect = this.parseDialect(config.dialect);
        if (config.strict != null)
            copy.strict = config.strict;
        if (config.wrap)
            copy.wrappers = copy.wrappers.concat(config.wrap);
        if (config.bufferLength != null)
            copy.bufferLength = config.bufferLength;
        return copy;
    }
    /**
    Tells you whether any [parse wrappers](#lr.ParserConfig.wrap)
    are registered for this parser.
    */
    hasWrappers() {
        return this.wrappers.length > 0;
    }
    /**
    Returns the name associated with a given term. This will only
    work for all terms when the parser was generated with the
    `--names` option. By default, only the names of tagged terms are
    stored.
    */
    getName(term) {
        return this.termNames ? this.termNames[term] : String(term <= this.maxNode && this.nodeSet.types[term].name || term);
    }
    /**
    The eof term id is always allocated directly after the node
    types. @internal
    */
    get eofTerm() { return this.maxNode + 1; }
    /**
    The type of top node produced by the parser.
    */
    get topNode() { return this.nodeSet.types[this.top[1]]; }
    /**
    @internal
    */
    dynamicPrecedence(term) {
        let prec = this.dynamicPrecedences;
        return prec == null ? 0 : prec[term] || 0;
    }
    /**
    @internal
    */
    parseDialect(dialect) {
        let values = Object.keys(this.dialects), flags = values.map(() => false);
        if (dialect)
            for (let part of dialect.split(" ")) {
                let id = values.indexOf(part);
                if (id >= 0)
                    flags[id] = true;
            }
        let disabled = null;
        for (let i = 0; i < values.length; i++)
            if (!flags[i]) {
                for (let j = this.dialects[values[i]], id; (id = this.data[j++]) != 65535 /* Seq.End */;)
                    (disabled || (disabled = new Uint8Array(this.maxTerm + 1)))[id] = 1;
            }
        return new Dialect(dialect, flags, disabled);
    }
    /**
    Used by the output of the parser generator. Not available to
    user code. @hide
    */
    static deserialize(spec) {
        return new LRParser(spec);
    }
}
function pair(data, off) { return data[off] | (data[off + 1] << 16); }
function findFinished(stacks) {
    let best = null;
    for (let stack of stacks) {
        let stopped = stack.p.stoppedAt;
        if ((stack.pos == stack.p.stream.end || stopped != null && stack.pos > stopped) &&
            stack.p.parser.stateFlag(stack.state, 2 /* StateFlag.Accepting */) &&
            (!best || best.score < stack.score))
            best = stack;
    }
    return best;
}
function getSpecializer(spec) {
    if (spec.external) {
        let mask = spec.extend ? 1 /* Specialize.Extend */ : 0 /* Specialize.Specialize */;
        return (value, stack) => (spec.external(value, stack) << 1) | mask;
    }
    return spec.get;
}

// This file was generated by lezer-generator. You probably shouldn't edit it.
const noSemi = 312,
  incdec = 1,
  incdecPrefix = 2,
  questionDot = 3,
  JSXStartTag = 4,
  insertSemi = 313,
  spaces = 315,
  newline = 316,
  LineComment = 5,
  BlockComment = 6,
  Dialect_jsx = 0;

/* Hand-written tokenizers for JavaScript tokens that can't be
   expressed by lezer's built-in tokenizer. */

const space = [9, 10, 11, 12, 13, 32, 133, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200,
               8201, 8202, 8232, 8233, 8239, 8287, 12288];

const braceR = 125, semicolon = 59, slash = 47, star = 42, plus = 43, minus = 45, lt = 60, comma = 44,
      question = 63, dot = 46;

const trackNewline = new ContextTracker({
  start: false,
  shift(context, term) {
    return term == LineComment || term == BlockComment || term == spaces ? context : term == newline
  },
  strict: false
});

const insertSemicolon = new ExternalTokenizer((input, stack) => {
  let {next} = input;
  if (next == braceR || next == -1 || stack.context)
    input.acceptToken(insertSemi);
}, {contextual: true, fallback: true});

const noSemicolon = new ExternalTokenizer((input, stack) => {
  let {next} = input, after;
  if (space.indexOf(next) > -1) return
  if (next == slash && ((after = input.peek(1)) == slash || after == star)) return
  if (next != braceR && next != semicolon && next != -1 && !stack.context)
    input.acceptToken(noSemi);
}, {contextual: true});

const operatorToken = new ExternalTokenizer((input, stack) => {
  let {next} = input;
  if (next == plus || next == minus) {
    input.advance();
    if (next == input.next) {
      input.advance();
      let mayPostfix = !stack.context && stack.canShift(incdec);
      input.acceptToken(mayPostfix ? incdec : incdecPrefix);
    }
  } else if (next == question && input.peek(1) == dot) {
    input.advance(); input.advance();
    if (input.next < 48 || input.next > 57) // No digit after
      input.acceptToken(questionDot);
  }
}, {contextual: true});

function identifierChar(ch, start) {
  return ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122 || ch == 95 || ch >= 192 ||
    !start && ch >= 48 && ch <= 57
}

const jsx = new ExternalTokenizer((input, stack) => {
  if (input.next != lt || !stack.dialectEnabled(Dialect_jsx)) return
  input.advance();
  if (input.next == slash) return
  // Scan for an identifier followed by a comma or 'extends', don't
  // treat this as a start tag if present.
  let back = 0;
  while (space.indexOf(input.next) > -1) { input.advance(); back++; }
  if (identifierChar(input.next, true)) {
    input.advance();
    back++;
    while (identifierChar(input.next, false)) { input.advance(); back++; }
    while (space.indexOf(input.next) > -1) { input.advance(); back++; }
    if (input.next == comma) return
    for (let i = 0;; i++) {
      if (i == 7) {
        if (!identifierChar(input.next, true)) return
        break
      }
      if (input.next != "extends".charCodeAt(i)) break
      input.advance();
      back++;
    }
  }
  input.acceptToken(JSXStartTag, -back);
});

const jsHighlight = styleTags({
  "get set async static": tags.modifier,
  "for while do if else switch try catch finally return throw break continue default case": tags.controlKeyword,
  "in of await yield void typeof delete instanceof": tags.operatorKeyword,
  "let var const using function class extends": tags.definitionKeyword,
  "import export from": tags.moduleKeyword,
  "with debugger as new": tags.keyword,
  TemplateString: tags.special(tags.string),
  super: tags.atom,
  BooleanLiteral: tags.bool,
  this: tags.self,
  null: tags.null,
  Star: tags.modifier,
  VariableName: tags.variableName,
  "CallExpression/VariableName TaggedTemplateExpression/VariableName": tags.function(tags.variableName),
  VariableDefinition: tags.definition(tags.variableName),
  Label: tags.labelName,
  PropertyName: tags.propertyName,
  PrivatePropertyName: tags.special(tags.propertyName),
  "CallExpression/MemberExpression/PropertyName": tags.function(tags.propertyName),
  "FunctionDeclaration/VariableDefinition": tags.function(tags.definition(tags.variableName)),
  "ClassDeclaration/VariableDefinition": tags.definition(tags.className),
  PropertyDefinition: tags.definition(tags.propertyName),
  PrivatePropertyDefinition: tags.definition(tags.special(tags.propertyName)),
  UpdateOp: tags.updateOperator,
  "LineComment Hashbang": tags.lineComment,
  BlockComment: tags.blockComment,
  Number: tags.number,
  String: tags.string,
  Escape: tags.escape,
  ArithOp: tags.arithmeticOperator,
  LogicOp: tags.logicOperator,
  BitOp: tags.bitwiseOperator,
  CompareOp: tags.compareOperator,
  RegExp: tags.regexp,
  Equals: tags.definitionOperator,
  Arrow: tags.function(tags.punctuation),
  ": Spread": tags.punctuation,
  "( )": tags.paren,
  "[ ]": tags.squareBracket,
  "{ }": tags.brace,
  "InterpolationStart InterpolationEnd": tags.special(tags.brace),
  ".": tags.derefOperator,
  ", ;": tags.separator,
  "@": tags.meta,

  TypeName: tags.typeName,
  TypeDefinition: tags.definition(tags.typeName),
  "type enum interface implements namespace module declare": tags.definitionKeyword,
  "abstract global Privacy readonly override": tags.modifier,
  "is keyof unique infer": tags.operatorKeyword,

  JSXAttributeValue: tags.attributeValue,
  JSXText: tags.content,
  "JSXStartTag JSXStartCloseTag JSXSelfCloseEndTag JSXEndTag": tags.angleBracket,
  "JSXIdentifier JSXNameSpacedName": tags.tagName,
  "JSXAttribute/JSXIdentifier JSXAttribute/JSXNameSpacedName": tags.attributeName,
  "JSXBuiltin/JSXIdentifier": tags.standard(tags.tagName)
});

// This file was generated by lezer-generator. You probably shouldn't edit it.
const spec_identifier = {__proto__:null,export:20, as:25, from:33, default:36, async:41, function:42, extends:54, this:58, true:66, false:66, null:78, void:82, typeof:86, super:102, new:136, delete:148, yield:157, await:161, class:166, public:229, private:229, protected:229, readonly:231, instanceof:250, satisfies:253, in:254, const:256, import:290, keyof:345, unique:349, infer:355, is:391, abstract:411, implements:413, type:415, let:418, var:420, using:423, interface:429, enum:433, namespace:439, module:441, declare:445, global:449, for:468, of:477, while:480, with:484, do:488, if:492, else:494, switch:498, case:504, try:510, catch:514, finally:518, return:522, throw:526, break:530, continue:534, debugger:538};
const spec_word = {__proto__:null,async:123, get:125, set:127, declare:189, public:191, private:191, protected:191, static:193, abstract:195, override:197, readonly:203, accessor:205, new:395};
const spec_LessThan = {__proto__:null,"<":187};
const parser = LRParser.deserialize({
  version: 14,
  states: "$@QO%TQ^OOO%[Q^OOO'_Q`OOP(lOWOOO*zQ?NdO'#CiO+RO!bO'#CjO+aO#tO'#CjO+oO!0LbO'#D^O.QQ^O'#DdO.bQ^O'#DoO%[Q^O'#DwO0fQ^O'#EPOOQ?Mr'#EX'#EXO1PQWO'#EUOOQO'#Em'#EmOOQO'#Ih'#IhO1XQWO'#GpO1dQWO'#ElO1iQWO'#ElO3hQ?NdO'#JmO6[Q?NdO'#JnO6uQWO'#F[O6zQ&jO'#FsOOQ?Mr'#Fe'#FeO7VO,YO'#FeO7eQ7[O'#FzO9RQWO'#FyOOQ?Mr'#Jn'#JnOOQ?Mp'#Jm'#JmO9WQWO'#GtOOQU'#KZ'#KZO9cQWO'#IUO9hQ?MxO'#IVOOQU'#JZ'#JZOOQU'#IZ'#IZQ`Q^OOO`Q^OOO9pQMnO'#DsO9wQ^O'#D{O:OQ^O'#D}O9^QWO'#GpO:VQ7[O'#CoO:eQWO'#EkO:pQWO'#EvO:uQ7[O'#FdO;dQWO'#GpOOQO'#K['#K[O;iQWO'#K[O;wQWO'#GxO;wQWO'#GyO;wQWO'#G{O9^QWO'#HOO<nQWO'#HRO>VQWO'#CeO>gQWO'#H_O>oQWO'#HeO>oQWO'#HgO`Q^O'#HiO>oQWO'#HkO>oQWO'#HnO>tQWO'#HtO>yQ?MyO'#HzO%[Q^O'#H|O?UQ?MyO'#IOO?aQ?MyO'#IQO9hQ?MxO'#ISO?lQ?NdO'#CiO@nQ`O'#DiQOQWOOO%[Q^O'#D}OAUQWO'#EQO:VQ7[O'#EkOAaQWO'#EkOAlQpO'#FdOOQU'#Cg'#CgOOQ?Mp'#Dn'#DnOOQ?Mp'#Jq'#JqO%[Q^O'#JqOOQO'#Jt'#JtOOQO'#Id'#IdOBlQ`O'#EdOOQ?Mp'#Ec'#EcOOQ?Mp'#Jx'#JxOChQ?NQO'#EdOCrQ`O'#ETOOQO'#Js'#JsODWQ`O'#JtOEeQ`O'#ETOCrQ`O'#EdPErO#@ItO'#CbPOOO)CDx)CDxOOOO'#I['#I[OE}O!bO,59UOOQ?Mr,59U,59UOOOO'#I]'#I]OF]O#tO,59UO%[Q^O'#D`OOOO'#I_'#I_OFkO!0LbO,59xOOQ?Mr,59x,59xOFyQ^O'#I`OG^QWO'#JoOI]QrO'#JoO+}Q^O'#JoOIdQWO,5:OOIzQWO'#EmOJXQWO'#KOOJdQWO'#J}OJdQWO'#J}OJlQWO,5;ZOJqQWO'#J|OOQ?Mv,5:Z,5:ZOJxQ^O,5:ZOLvQ?NdO,5:cOMgQWO,5:kONQQ?MxO'#J{ONXQWO'#JzO9WQWO'#JzONmQWO'#JzONuQWO,5;YONzQWO'#JzO!#PQrO'#JnOOQ?Mr'#Ci'#CiO%[Q^O'#EPO!#oQrO,5:pOOQQ'#Ju'#JuOOQO-E<f-E<fO9^QWO,5=[O!$VQWO,5=[O!$[Q^O,5;WO!&_Q7[O'#EhO!'xQWO,5;WO!'}Q^O'#DvO!(XQ`O,5;aO!(aQ`O,5;aO%[Q^O,5;aOOQU'#FS'#FSOOQU'#FU'#FUO%[Q^O,5;bO%[Q^O,5;bO%[Q^O,5;bO%[Q^O,5;bO%[Q^O,5;bO%[Q^O,5;bO%[Q^O,5;bO%[Q^O,5;bO%[Q^O,5;bO%[Q^O,5;bOOQU'#FY'#FYO!(oQ^O,5;sOOQ?Mr,5;x,5;xOOQ?Mr,5;y,5;yOOQ?Mr,5;{,5;{O%[Q^O'#IlO!*rQ?MxO,5<gO%[Q^O,5;bO!&_Q7[O,5;bO!+aQ7[O,5;bO!-RQ7[O'#EZO%[Q^O,5;vOOQ?Mr,5;z,5;zO!-YQ&jO'#FiO!.VQ&jO'#KSO!-qQ&jO'#KSO!.^Q&jO'#KSOOQO'#KS'#KSO!.rQ&jO,5<ROOOS,5<_,5<_O!/TQ^O'#FuOOOS'#Ik'#IkO7VO,YO,5<PO!/[Q&jO'#FwOOQ?Mr,5<P,5<PO!/{Q!LQO'#CvOOQ?Mr'#Cz'#CzO!0`O!0LbO'#DOO!0|Q7[O,5<dO!1TQWO,5<fO!2pQ$ISO'#GVO!2}QWO'#GWO!3SQWO'#GWO!4rQ$ISO'#G[O!5nQ`O'#G`OOQO'#Gk'#GkO!+hQ7[O'#GjOOQO'#Gm'#GmO!+hQ7[O'#GlO!6aQ!LQO'#JgOOQ?Mr'#Jg'#JgO!6kQWO'#JfO!6yQWO'#JeO!7RQWO'#CuOOQ?Mr'#Cx'#CxO!7ZQWO'#CzOOQ?Mr'#DS'#DSOOQ?Mr'#DU'#DUO1SQWO'#DWO!+hQ7[O'#F}O!+hQ7[O'#GPO!7`QWO'#GRO!7eQWO'#GSO!3SQWO'#GYO!+hQ7[O'#G_O!7jQWO'#EnO!8XQWO,5<eOOQ?Mp'#Cr'#CrO!8aQWO'#EoO!9ZQ`O'#EpOOQ?Mp'#J|'#J|O!9bQ?MxO'#K]O9hQ?MxO,5=`O`Q^O,5>pOOQU'#Jc'#JcOOQU,5>q,5>qOOQU-E<X-E<XO!;aQ?NdO,5:_O!9UQ`O,5:]O!=zQ?NdO,5:gO%[Q^O,5:gO!@bQ?NdO,5:iOOQO,5@v,5@vO!ARQ7[O,5=[O!AaQ?MxO'#JdO9RQWO'#JdO!ArQ?MxO,59ZO!A}Q`O,59ZO!BVQ7[O,59ZO:VQ7[O,59ZO!BbQWO,5;WO!BjQWO'#H^O!COQWO'#K`O%[Q^O,5;|O!9UQ`O,5<OO!CWQWO,5=wO!C]QWO,5=wO!CbQWO,5=wO9hQ?MxO,5=wO;wQWO,5=gOOQO'#Cv'#CvO!CpQ`O,5=dO!CxQ7[O,5=eO!DTQWO,5=gO!DYQpO,5=jO!DbQWO'#K[O>tQWO'#HTO9^QWO'#HVO!DgQWO'#HVO:VQ7[O'#HXO!DlQWO'#HXOOQU,5=m,5=mO!DqQWO'#HYO!ESQWO'#CoO!EXQWO,59PO!EcQWO,59PO!GhQ^O,59POOQU,59P,59PO!GxQ?MxO,59PO%[Q^O,59PO!JTQ^O'#HaOOQU'#Hb'#HbOOQU'#Hc'#HcO`Q^O,5=yO!JkQWO,5=yO`Q^O,5>PO`Q^O,5>RO!JpQWO,5>TO`Q^O,5>VO!JuQWO,5>YO!JzQ^O,5>`OOQU,5>f,5>fO%[Q^O,5>fO9hQ?MxO,5>hOOQU,5>j,5>jO# UQWO,5>jOOQU,5>l,5>lO# UQWO,5>lOOQU,5>n,5>nO# rQ`O'#D[O%[Q^O'#JqO# |Q`O'#JqO#!kQ`O'#DjO#!|Q`O'#DjO#%_Q^O'#DjO#%fQWO'#JpO#%nQWO,5:TO#%sQWO'#EqO#&RQWO'#KPO#&ZQWO,5;[O#&`Q`O'#DjO#&mQ`O'#ESOOQ?Mr,5:l,5:lO%[Q^O,5:lO#&tQWO,5:lO>tQWO,5;VO!A}Q`O,5;VO!BVQ7[O,5;VO:VQ7[O,5;VO#&|QWO,5@]O#'RQ(CYO,5:pOOQO-E<b-E<bO#(XQ?NQO,5;OOCrQ`O,5:oO#(cQ`O,5:oOCrQ`O,5;OO!ArQ?MxO,5:oOOQ?Mp'#Eg'#EgOOQO,5;O,5;OO%[Q^O,5;OO#(pQ?MxO,5;OO#({Q?MxO,5;OO!A}Q`O,5:oOOQO,5;U,5;UO#)ZQ?MxO,5;OPOOO'#IY'#IYP#)oO#@ItO,58|POOO,58|,58|OOOO-E<Y-E<YOOQ?Mr1G.p1G.pOOOO-E<Z-E<ZO#)zQpO,59zOOOO-E<]-E<]OOQ?Mr1G/d1G/dO#*PQrO,5>zO+}Q^O,5>zOOQO,5?Q,5?QO#*ZQ^O'#I`OOQO-E<^-E<^O#*hQWO,5@ZO#*pQrO,5@ZO#*wQWO,5@iOOQ?Mr1G/j1G/jO%[Q^O,5@jO#+PQWO'#IfOOQO-E<d-E<dO#*wQWO,5@iOOQ?Mp1G0u1G0uOOQ?Mv1G/u1G/uOOQ?Mv1G0V1G0VO%[Q^O,5@gO#+eQ?MxO,5@gO#+vQ?MxO,5@gO#+}QWO,5@fO9WQWO,5@fO#,VQWO,5@fO#,eQWO'#IiO#+}QWO,5@fOOQ?Mp1G0t1G0tO!(XQ`O,5:rO!(dQ`O,5:rOOQQ,5:t,5:tO#-VQYO,5:tO#-_Q7[O1G2vO9^QWO1G2vOOQ?Mr1G0r1G0rO#-mQ?NdO1G0rO#.rQ?NbO,5;SOOQ?Mr'#GU'#GUO#/`Q?NdO'#JgO!$[Q^O1G0rO#1hQrO'#JrO%[Q^O'#JrO#1rQWO,5:bOOQ?Mr'#D['#D[OOQ?Mr1G0{1G0{O%[Q^O1G0{OOQ?Mr1G1e1G1eO#1wQWO1G0{O#4]Q?NdO1G0|O#4dQ?NdO1G0|O#6zQ?NdO1G0|O#7RQ?NdO1G0|O#9iQ?NdO1G0|O#<PQ?NdO1G0|O#<WQ?NdO1G0|O#<_Q?NdO1G0|O#>uQ?NdO1G0|O#>|Q?NdO1G0|O#AZQ07bO'#CiO#CUQ07bO1G1_O#C]Q07bO'#JnO#CpQ?NdO,5?WOOQ?Mp-E<j-E<jO#E}Q?NdO1G0|O#FzQ?NdO1G0|OOQ?Mr1G0|1G0|O#GzQ7[O'#JwO#HUQWO,5:uO#HZQ?NdO1G1bO#H}Q&jO,5<VO#IVQ&jO,5<WO#I_Q&jO'#FnO#IvQWO'#FmOOQO'#KT'#KTOOQO'#Ij'#IjO#I{Q&jO1G1mOOQ?Mr1G1m1G1mOOOS1G1x1G1xO#J^Q07bO'#JmO#JhQWO,5<aO!(oQ^O,5<aOOOS-E<i-E<iOOQ?Mr1G1k1G1kO#JmQ`O'#KSOOQ?Mr,5<c,5<cO#JuQ`O,5<cO!&_Q7[O'#DQOOOO'#I^'#I^O#JzO!0LbO,59jOOQ?Mr,59j,59jO%[Q^O1G2OO!7eQWO'#InO#KVQ7[O,5<xOOQ?Mr,5<u,5<uO!+hQ7[O'#IqO#KuQ7[O,5=UO!+hQ7[O'#IsO#LhQ7[O,5=WO!&_Q7[O,5=YOOQO1G2Q1G2QO#LrQpO'#CrO#MVQ$ISO'#EoO#NUQ`O'#G`O#NrQpO,5<qO#NyQWO'#KWO9WQWO'#KWO$ XQWO,5<sO!+hQ7[O,5<rO$ ^QWO'#GXO$ oQWO,5<rO$ tQpO'#GUO$!RQpO'#KXO$!]QWO'#KXO!&_Q7[O'#KXO$!bQWO,5<vO$!gQ`O'#GaO!5iQ`O'#GaO$!xQWO'#GcO$!}QWO'#GeO!3SQWO'#GhO$#SQ?MxO'#IpO$#_Q`O,5<zOOQ?Mv,5<z,5<zO$#fQ`O'#GaO$#tQ`O'#GbO$#|Q`O'#GbO$$RQ7[O,5=UO$$cQ7[O,5=WOOQ?Mr,5=Z,5=ZO!+hQ7[O,5@QO!+hQ7[O,5@QO$$sQWO'#IuO$%OQWO,5@PO$%WQWO,59aOOQ?Mr,59f,59fO$%zQ!LSO,59rOOQ?Mr'#Jk'#JkO$&mQ7[O,5<iO$'`Q7[O,5<kO@fQWO,5<mOOQ?Mr,5<n,5<nO$'jQWO,5<tO$'oQ7[O,5<yO$(PQWO'#JzO!$[Q^O1G2PO$(UQWO1G2PO9WQWO'#J}O9WQWO'#EqO%[Q^O'#EqO9WQWO'#IwO$(ZQ?MxO,5@wOOQU1G2z1G2zOOQU1G4[1G4[OOQ?Mr1G/y1G/yOOQ?Mr1G/w1G/wO$*]Q?NdO1G0ROOQU1G2v1G2vO!&_Q7[O1G2vO%[Q^O1G2vO#-bQWO1G2vO$,aQ7[O'#EhOOQ?Mp,5@O,5@OO$,kQ?MxO,5@OOOQU1G.u1G.uO!ArQ?MxO1G.uO!A}Q`O1G.uO!BVQ7[O1G.uO$,|QWO1G0rO$-RQWO'#CiO$-^QWO'#KaO$-fQWO,5=xO$-kQWO'#KaO$-pQWO'#KaO$.OQWO'#I}O$.^QWO,5@zO$.fQrO1G1hOOQ?Mr1G1j1G1jO9^QWO1G3cO@fQWO1G3cO$.mQWO1G3cO$.rQWO1G3cOOQU1G3c1G3cO!DTQWO1G3RO!&_Q7[O1G3OO$.wQWO1G3OOOQU1G3P1G3PO!&_Q7[O1G3PO$.|QWO1G3PO$/UQ`O'#G}OOQU1G3R1G3RO!5iQ`O'#IyO!DYQpO1G3UOOQU1G3U1G3UOOQU,5=o,5=oO$/^Q7[O,5=qO9^QWO,5=qO$!}QWO,5=sO9RQWO,5=sO!A}Q`O,5=sO!BVQ7[O,5=sO:VQ7[O,5=sO$/lQWO'#K_O$/wQWO,5=tOOQU1G.k1G.kO$/|Q?MxO1G.kO@fQWO1G.kO$0XQWO1G.kO9hQ?MxO1G.kO$2aQrO,5@|O$2nQWO,5@|O9WQWO,5@|O$2yQ^O,5={O$3QQWO,5={OOQU1G3e1G3eO`Q^O1G3eOOQU1G3k1G3kOOQU1G3m1G3mO>oQWO1G3oO$3VQ^O1G3qO$7ZQ^O'#HpOOQU1G3t1G3tO$7hQWO'#HvO>tQWO'#HxOOQU1G3z1G3zO$7pQ^O1G3zO9hQ?MxO1G4QOOQU1G4S1G4SOOQ?Mp'#G]'#G]O9hQ?MxO1G4UO9hQ?MxO1G4WO$;wQWO,5@]O!(oQ^O,5;]O9WQWO,5;]O>tQWO,5:UO!(oQ^O,5:UO!A}Q`O,5:UO$;|Q07bO,5:UOOQO,5;],5;]O$<WQ`O'#IaO$<nQWO,5@[OOQ?Mr1G/o1G/oO$<vQ`O'#IgO$=QQWO,5@kOOQ?Mp1G0v1G0vO#!|Q`O,5:UOOQO'#Ic'#IcO$=YQ`O,5:nOOQ?Mv,5:n,5:nO#&wQWO1G0WOOQ?Mr1G0W1G0WO%[Q^O1G0WOOQ?Mr1G0q1G0qO>tQWO1G0qO!A}Q`O1G0qO!BVQ7[O1G0qOOQ?Mp1G5w1G5wO!ArQ?MxO1G0ZOOQO1G0j1G0jO%[Q^O1G0jO$=aQ?MxO1G0jO$=lQ?MxO1G0jO!A}Q`O1G0ZOCrQ`O1G0ZO$=zQ?MxO1G0jOOQO1G0Z1G0ZO$>`Q?NdO1G0jPOOO-E<W-E<WPOOO1G.h1G.hOOOO1G/f1G/fO$>jQpO,5<gO$>rQrO1G4fOOQO1G4l1G4lO%[Q^O,5>zO$>|QWO1G5uO$?UQWO1G6TO$?^QrO1G6UO9WQWO,5?QO$?hQ?NdO1G6RO%[Q^O1G6RO$?xQ?MxO1G6RO$@ZQWO1G6QO$@ZQWO1G6QO9WQWO1G6QO$@cQWO,5?TO9WQWO,5?TOOQO,5?T,5?TO$@wQWO,5?TO$(PQWO,5?TOOQO-E<g-E<gOOQQ1G0^1G0^OOQQ1G0`1G0`O#-YQWO1G0`OOQU7+(b7+(bO!&_Q7[O7+(bO%[Q^O7+(bO$AVQWO7+(bO$AbQ7[O7+(bO$ApQ?NdO,5=UO$CxQ?NdO,5=WO$FQQ?NdO,5=UO$H`Q?NdO,5=WO$JnQ?NdO,59rO$LsQ?NdO,5<iO$N{Q?NdO,5<kO%#TQ?NdO,5<yOOQ?Mr7+&^7+&^O%%cQ?NdO7+&^O%&VQ^O'#IbO%&dQWO,5@^O%&lQrO,5@^OOQ?Mr1G/|1G/|O%&vQWO7+&gOOQ?Mr7+&g7+&gO%&{Q07bO,5:cO%[Q^O7+&yO%'VQ07bO,5:_O%'dQ07bO,5:gO%'nQ07bO,5:iO%'xQ7[O'#IeO%(SQWO,5@cOOQ?Mr1G0a1G0aOOQO1G1q1G1qOOQO1G1r1G1rO%([QtO,5<YO!(oQ^O,5<XOOQO-E<h-E<hOOQ?Mr7+'X7+'XOOOS7+'d7+'dOOOS1G1{1G1{O%(gQWO1G1{OOQ?Mr1G1}1G1}O%(lQpO,59lOOOO-E<[-E<[OOQ?Mr1G/U1G/UO%(sQ?NdO7+'jOOQ?Mr,5?Y,5?YO%)gQpO,5?YOOQ?Mr1G2d1G2dP!&_Q7[O'#InPOQ?Mr-E<l-E<lO%*VQ7[O,5?]OOQ?Mr-E<o-E<oO%*xQ7[O,5?_OOQ?Mr-E<q-E<qO%+SQpO1G2tO%+ZQpO'#CrO%+qQ7[O'#J}O%+xQ^O'#EqOOQ?Mr1G2]1G2]O%,SQWO'#ImO%,hQWO,5@rO%,hQWO,5@rO%,pQWO,5@rO%,{QWO,5@rOOQO1G2_1G2_O%-ZQ7[O1G2^O!+hQ7[O1G2^O%-kQ$ISO'#IoO%-xQWO,5@sO!&_Q7[O,5@sO%.QQpO,5@sOOQ?Mr1G2b1G2bOOQ?Mp,5<{,5<{OOQ?Mp,5<|,5<|O$(PQWO,5<|OCcQWO,5<|O!A}Q`O,5<{OOQO'#Gd'#GdO%.[QWO,5<}OOQ?Mp,5=P,5=PO$(PQWO,5=SOOQO,5?[,5?[OOQO-E<n-E<nOOQ?Mv1G2f1G2fO!5iQ`O,5<{O%.dQWO,5<|O$!xQWO,5<}O%.oQ`O,5<|O!+hQ7[O'#IqO%/`Q7[O1G2pO!+hQ7[O'#IsO%0RQ7[O1G2rO%0]Q7[O1G5lO%0gQ7[O1G5lOOQO,5?a,5?aOOQO-E<s-E<sOOQO1G.{1G.{O!9UQ`O,59tO%[Q^O,59tOOQ?Mr,5<h,5<hO%0tQWO1G2XO!+hQ7[O1G2`O%0yQ?NdO7+'kOOQ?Mr7+'k7+'kO!$[Q^O7+'kO%1mQWO,5;]OOQ?Mp,5?c,5?cOOQ?Mp-E<u-E<uO%1rQpO'#KYO#&wQWO7+(bO4UQrO7+(bO$AYQWO7+(bO%1|Q?NbO'#CiO%2aQ?NbO,5=QO%3RQWO,5=QOOQ?Mp1G5j1G5jOOQU7+$a7+$aO!ArQ?MxO7+$aO!A}Q`O7+$aO!$[Q^O7+&^O%3WQWO'#I|O%3oQWO,5@{OOQO1G3d1G3dO9^QWO,5@{O%3oQWO,5@{O%3wQWO,5@{OOQO,5?i,5?iOOQO-E<{-E<{OOQ?Mr7+'S7+'SO%3|QWO7+(}O9hQ?MxO7+(}O9^QWO7+(}O@fQWO7+(}OOQU7+(m7+(mO%4RQ?NbO7+(jO!&_Q7[O7+(jO%4]QpO7+(kOOQU7+(k7+(kO!&_Q7[O7+(kO%4dQWO'#K^O%4oQWO,5=iOOQO,5?e,5?eOOQO-E<w-E<wOOQU7+(p7+(pO%6RQ`O'#HWOOQU1G3]1G3]O!&_Q7[O1G3]O%[Q^O1G3]O%6YQWO1G3]O%6eQ7[O1G3]O9hQ?MxO1G3_O$!}QWO1G3_O9RQWO1G3_O!A}Q`O1G3_O!BVQ7[O1G3_O%6sQWO'#I{O%7XQWO,5@yO%7aQ`O,5@yOOQ?Mp1G3`1G3`OOQU7+$V7+$VO@fQWO7+$VO9hQ?MxO7+$VO%7lQWO7+$VO%[Q^O1G6hO%[Q^O1G6iO%7qQ?MxO1G6hO%7{Q^O1G3gO%8SQWO1G3gO%8XQ^O1G3gOOQU7+)P7+)PO9hQ?MxO7+)ZO`Q^O7+)]OOQU'#Kd'#KdOOQU'#JO'#JOO%8`Q^O,5>[OOQU,5>[,5>[O%[Q^O'#HqO%8mQWO'#HsOOQU,5>b,5>bO9WQWO,5>bOOQU,5>d,5>dOOQU7+)f7+)fOOQU7+)l7+)lOOQU7+)p7+)pOOQU7+)r7+)rO%8rQ`O1G5wO%9WQ07bO1G0wO%9bQWO1G0wOOQO1G/p1G/pO%9mQ07bO1G/pO>tQWO1G/pO!(oQ^O'#DjOOQO,5>{,5>{OOQO-E<_-E<_OOQO,5?R,5?ROOQO-E<e-E<eO!A}Q`O1G/pOOQO-E<a-E<aOOQ?Mv1G0Y1G0YOOQ?Mr7+%r7+%rO#&wQWO7+%rOOQ?Mr7+&]7+&]O>tQWO7+&]O!A}Q`O7+&]OOQO7+%u7+%uO$>`Q?NdO7+&UOOQO7+&U7+&UO%[Q^O7+&UO%9wQ?MxO7+&UO!ArQ?MxO7+%uO!A}Q`O7+%uO%:SQ?MxO7+&UO%:bQ?NdO7++mO%[Q^O7++mO%:rQWO7++lO%:rQWO7++lOOQO1G4o1G4oO9WQWO1G4oO%:zQWO1G4oOOQQ7+%z7+%zO#&wQWO<<K|O4UQrO<<K|O%;YQWO<<K|OOQU<<K|<<K|O!&_Q7[O<<K|O%[Q^O<<K|O%;bQWO<<K|O%;mQ?NdO,5?]O%=uQ?NdO,5?_O%?}Q?NdO1G2^O%B]Q?NdO1G2pO%DeQ?NdO1G2rO%FmQrO,5>|O%[Q^O,5>|OOQO-E<`-E<`O%FwQWO1G5xOOQ?Mr<<JR<<JRO%GPQ07bO1G0rO%IWQ07bO1G0|O%I_Q07bO1G0|O%K`Q07bO1G0|O%KgQ07bO1G0|O%MhQ07bO1G0|O& iQ07bO1G0|O& pQ07bO1G0|O& wQ07bO1G0|O&#xQ07bO1G0|O&$PQ07bO1G0|O&$WQ?NdO<<JeO&&OQ07bO1G0|O&&{Q07bO1G0|O&'{Q07bO'#JgO&*OQ07bO1G1bO&*]Q07bO1G0RO&*gQ7[O,5?POOQO-E<c-E<cO!(oQ^O'#FpOOQO'#KU'#KUOOQO1G1t1G1tO&*qQWO1G1sO&*vQ07bO,5?WOOOS7+'g7+'gOOOO1G/W1G/WOOQ?Mr1G4t1G4tO!+hQ7[O7+(`O&-WQrO'#CiO&-bQWO,5?XO9WQWO,5?XOOQO-E<k-E<kO&-pQWO1G6^O&-pQWO1G6^O&-xQWO1G6^O&.TQ7[O7+'xO&.eQpO,5?ZO&.oQWO,5?ZO!&_Q7[O,5?ZOOQO-E<m-E<mO&.tQpO1G6_O&/OQWO1G6_OOQ?Mp1G2h1G2hO$(PQWO1G2hOOQ?Mp1G2g1G2gO&/WQWO1G2iO!&_Q7[O1G2iOOQ?Mp1G2n1G2nO!A}Q`O1G2gOCcQWO1G2hO&/]QWO1G2iO&/eQWO1G2hO$!xQWO1G2iO&0XQ7[O,5?]OOQ?Mr-E<p-E<pO&0zQ7[O,5?_OOQ?Mr-E<r-E<rO!+hQ7[O7++WOOQ?Mr1G/`1G/`O&1UQWO1G/`OOQ?Mr7+'s7+'sO&1ZQ7[O7+'zO&1kQ?NdO<<KVOOQ?Mr<<KV<<KVO&2_QWO1G0wO!&_Q7[O'#IvO&2dQWO,5@tO&4fQrO<<K|O!&_Q7[O1G2lOOQU<<G{<<G{O!ArQ?MxO<<G{O&4mQ?NdO<<IxOOQ?Mr<<Ix<<IxOOQO,5?h,5?hO&5aQWO,5?hO&5fQWO,5?hOOQO-E<z-E<zO&5tQWO1G6gO&5tQWO1G6gO9^QWO1G6gO@fQWO<<LiOOQU<<Li<<LiO&5|QWO<<LiO9hQ?MxO<<LiOOQU<<LU<<LUO%4RQ?NbO<<LUOOQU<<LV<<LVO%4]QpO<<LVO&6RQ`O'#IxO&6^QWO,5@xO!(oQ^O,5@xOOQU1G3T1G3TO%+xQ^O'#JqOOQO'#Iz'#IzO9hQ?MxO'#IzO&6fQ`O,5=rOOQU,5=r,5=rO&6mQ`O'#EdO&7RQ`O'#GcO&7WQWO7+(wO&7]QWO7+(wOOQU7+(w7+(wO!&_Q7[O7+(wO%[Q^O7+(wO&7eQWO7+(wOOQU7+(y7+(yO9hQ?MxO7+(yO$!}QWO7+(yO9RQWO7+(yO!A}Q`O7+(yO&7pQWO,5?gOOQO-E<y-E<yOOQO'#HZ'#HZO&7{QWO1G6eO9hQ?MxO<<GqOOQU<<Gq<<GqO@fQWO<<GqO&8TQWO7+,SO&8YQWO7+,TO%[Q^O7+,SO%[Q^O7+,TOOQU7+)R7+)RO&8_QWO7+)RO&8dQ^O7+)RO&8kQWO7+)ROOQU<<Lu<<LuOOQU<<Lw<<LwOOQU-E<|-E<|OOQU1G3v1G3vO&8pQWO,5>]OOQU,5>_,5>_O&8uQWO1G3|O9WQWO7+&cO!(oQ^O7+&cOOQO7+%[7+%[O&8zQ07bO1G6UO>tQWO7+%[OOQ?Mr<<I^<<I^OOQ?Mr<<Iw<<IwO>tQWO<<IwOOQO<<Ip<<IpO$>`Q?NdO<<IpO%[Q^O<<IpOOQO<<Ia<<IaO!ArQ?MxO<<IaO&9UQ?MxO<<IpO&9aQ?NdO<= XO&9qQWO<= WOOQO7+*Z7+*ZO9WQWO7+*ZOOQUANAhANAhO&9yQrOANAhO!&_Q7[OANAhO#&wQWOANAhO4UQrOANAhO&:QQWOANAhO%[Q^OANAhO&:YQ?NdO7+'xO&<hQ?NdO,5?]O&>pQ?NdO,5?_O&@xQ?NdO7+'zO&CWQrO1G4hO&CbQ07bO7+&^O&EcQ07bO,5=UO&GgQ07bO,5=WO&GwQ07bO,5=UO&HXQ07bO,5=WO&HiQ07bO,59rO&JlQ07bO,5<iO&LlQ07bO,5<kO&N}Q07bO,5<yO'!pQ07bO7+'jO'!}Q07bO7+'kO'#[QWO,5<[OOQO7+'_7+'_O'#aQ7[O<<KzOOQO1G4s1G4sO'#hQWO1G4sO'#sQWO1G4sO'$RQWO7++xO'$RQWO7++xO!&_Q7[O1G4uO'$ZQpO1G4uO'$eQWO7++yOOQ?Mp7+(S7+(SO'$mQWO7+(TO'$xQpO7+(TOOQ?Mp7+(R7+(RO$(PQWO7+(SO'%PQWO7+(TO!&_Q7[O7+(TOCcQWO7+(SO'%UQWO7+(TO'%^Q7[O<<NrOOQ?Mr7+$z7+$zO'%hQpO,5?bOOQO-E<t-E<tO'%rQ?NbO7+(WOOQUAN=gAN=gO9^QWO1G5SOOQO1G5S1G5SO'&SQWO1G5SO'&XQWO7+,RO'&XQWO7+,RO9hQ?MxOANBTO@fQWOANBTOOQUANBTANBTOOQUANApANApOOQUANAqANAqO'&aQWO,5?dOOQO-E<v-E<vO'&lQ07bO1G6dOOQO,5?f,5?fOOQO-E<x-E<xOOQU1G3^1G3^O%+xQ^O,5<}O'&vQWO,5<}OOQU<<Lc<<LcO!&_Q7[O<<LcO&7WQWO<<LcO'&{QWO<<LcO%[Q^O<<LcOOQU<<Le<<LeO9hQ?MxO<<LeO$!}QWO<<LeO9RQWO<<LeO''TQ`O1G5RO''`QWO7+,POOQUAN=]AN=]O9hQ?MxOAN=]OOQU<= n<= nOOQU<= o<= oO''hQWO<= nO''mQWO<= oOOQU<<Lm<<LmO''rQWO<<LmO''wQ^O<<LmOOQU1G3w1G3wO>tQWO7+)hO'(OQWO<<I}O'(ZQ07bO<<I}OOQO<<Hv<<HvOOQ?MrAN?cAN?cOOQOAN?[AN?[O$>`Q?NdOAN?[OOQOAN>{AN>{O%[Q^OAN?[OOQO<<Mu<<MuOOQUG27SG27SO!&_Q7[OG27SO#&wQWOG27SO'(eQrOG27SO4UQrOG27SO'(lQWOG27SO'(tQ07bO<<JeO')RQ07bO1G2^O'*tQ07bO,5?]O',tQ07bO,5?_O'.tQ07bO1G2pO'0tQ07bO1G2rO'2tQ07bO<<KVO'3RQ07bO<<IxOOQO1G1v1G1vO!+hQ7[OANAfOOQO7+*_7+*_O'3`QWO7+*_O'3kQWO<= dO'3sQpO7+*aOOQ?Mp<<Ko<<KoO$(PQWO<<KoOCcQWO<<KoO'3}QWO<<KoOOQ?Mp<<Kn<<KnO'4YQpO<<KoO$(PQWO<<KnO'4aQWO<<KoO!&_Q7[O<<KoOOQO7+*n7+*nO9^QWO7+*nO'4fQWO<= mOOQUG27oG27oO9hQ?MxOG27oO!(oQ^O1G5OO'4nQWO7+,OO&7WQWOANA}OOQUANA}ANA}O!&_Q7[OANA}O'4vQWOANA}OOQUANBPANBPO9hQ?MxOANBPO$!}QWOANBPOOQO'#H['#H[OOQO7+*m7+*mOOQUG22wG22wOOQUANEYANEYOOQUANEZANEZOOQUANBXANBXO'5OQWOANBXOOQU<<MS<<MSO!(oQ^OAN?iOOQOG24vG24vO$>`Q?NdOG24vO#&wQWOLD,nOOQULD,nLD,nO!&_Q7[OLD,nO'5TQrOLD,nO'5[Q07bO7+'xO'6}Q07bO,5?]O'8}Q07bO,5?_O':}Q07bO7+'zO'<pQ7[OG27QOOQO<<My<<MyOOQ?MpANAZANAZO$(PQWOANAZOCcQWOANAZO'=QQWOANAZOOQ?MpANAYANAYO'=]QpOANAZOOQO<<NY<<NYOOQULD-ZLD-ZO'=dQ07bO7+*jOOQUG27iG27iO&7WQWOG27iO!&_Q7[OG27iOOQUG27kG27kO9hQ?MxOG27kOOQUG27sG27sO'=nQ07bOG25TOOQOLD*bLD*bOOQU!$(!Y!$(!YO#&wQWO!$(!YO!&_Q7[O!$(!YO'=xQ?NdOG27QOOQ?MpG26uG26uO$(PQWOG26uOCcQWOG26uO'@WQWOG26uOOQULD-TLD-TO&7WQWOLD-TOOQULD-VLD-VOOQU!)9Et!)9EtO#&wQWO!)9EtOOQ?MpLD,aLD,aO$(PQWOLD,aOCcQWOLD,aOOQU!$(!o!$(!oOOQU!.K;`!.K;`O'@cQ07bOG27QOOQ?Mp!$( {!$( {O$(PQWO!$( {OOQ?Mp!)9Eg!)9EgO!(oQ^O'#DwO1PQWO'#EUO'BUQrO'#JmO'B]QMnO'#DsO'BdQ^O'#D{O'BkQrO'#CiO'ERQrO'#CiO!(oQ^O'#D}O'EcQ^O,5;WO!(oQ^O,5;bO!(oQ^O,5;bO!(oQ^O,5;bO!(oQ^O,5;bO!(oQ^O,5;bO!(oQ^O,5;bO!(oQ^O,5;bO!(oQ^O,5;bO!(oQ^O,5;bO!(oQ^O,5;bO!(oQ^O'#IlO'GfQWO,5<gO!(oQ^O,5;bO'GnQ7[O,5;bO'IXQ7[O,5;bO!(oQ^O,5;vO!&_Q7[O'#GjO'GnQ7[O'#GjO!&_Q7[O'#GlO'GnQ7[O'#GlO1SQWO'#DWO1SQWO'#DWO!&_Q7[O'#F}O'GnQ7[O'#F}O!&_Q7[O'#GPO'GnQ7[O'#GPO!&_Q7[O'#G_O'GnQ7[O'#G_O!(oQ^O,5:gO'I`Q`O'#D[O!(oQ^O,5@jO'EcQ^O1G0rO'IjQ07bO'#CiO!(oQ^O1G2OO!&_Q7[O'#IqO'GnQ7[O'#IqO!&_Q7[O'#IsO'GnQ7[O'#IsO'ItQpO'#CrO!&_Q7[O,5<rO'GnQ7[O,5<rO'EcQ^O1G2PO!(oQ^O7+&yO!&_Q7[O1G2^O'GnQ7[O1G2^O!&_Q7[O'#IqO'GnQ7[O'#IqO!&_Q7[O'#IsO'GnQ7[O'#IsO!&_Q7[O1G2`O'GnQ7[O1G2`O'EcQ^O7+'kO'EcQ^O7+&^O!&_Q7[OANAfO'GnQ7[OANAfO'JXQWO'#ElO'J^QWO'#ElO'JfQWO'#F[O'JkQWO'#EvO'JpQWO'#KOO'J{QWO'#J|O'KWQWO,5;WO'K]Q7[O,5<dO'KdQWO'#GWO'KiQWO'#GWO'KnQWO,5<eO'KvQWO,5;WO'LOQ07bO1G1_O'LVQWO,5<rO'L[QWO,5<rO'LaQWO,5<tO'LfQWO,5<tO'LkQWO1G2PO'LpQWO1G0rO'LuQ7[O<<KzO'L|Q7[O<<KzO7eQ7[O'#FzO9RQWO'#FyOAaQWO'#EkO!(oQ^O,5;sO!3SQWO'#GWO!3SQWO'#GWO!3SQWO'#GYO!3SQWO'#GYO!+hQ7[O7+(`O!+hQ7[O7+(`O%+SQpO1G2tO%+SQpO1G2tO!&_Q7[O,5=YO!&_Q7[O,5=Y",
  stateData: "'NQ~O'wOS'xOSTOS'yRQ~OPYOQYOSfOY!VOaqOdzOeyOmkOoYOpkOqkOwkOyYO{YO!PWO!TkO!UkO![XO!fuO!iZO!lYO!mYO!nYO!pvO!rwO!uxO!y]O#t!PO$V|O%e}O%g!QO%i!OO%j!OO%k!OO%n!RO%p!SO%s!TO%t!TO%v!UO&S!WO&Y!XO&[!YO&^!ZO&`![O&c!]O&i!^O&o!_O&q!`O&s!aO&u!bO&w!cO(OSO(QTO(TUO([VO(j[O(yiO~OWtO~P`OPYOQYOSfOd!jOe!iOmkOoYOpkOqkOwkOyYO{YO!PWO!TkO!UkO![!eO!fuO!iZO!lYO!mYO!nYO!pvO!r!gO!u!hO$V!kO(O!dO(QTO(TUO([VO(j[O(yiO~Oa!wOp!nO!P!oO!_!yO!`!vO!a!vO!y;QO#Q!pO#R!pO#S!xO#T!pO#U!pO#X!zO#Y!zO(P!lO(QTO(TUO(`!mO(j!sO~O'y!{O~OP]XR]X[]Xa]Xo]X}]X!P]X!Y]X!i]X!m]X#O]X#P]X#]]X#hfX#k]X#l]X#m]X#n]X#o]X#p]X#q]X#r]X#s]X#u]X#w]X#y]X#z]X$P]X'u]X([]X(m]X(t]X(u]X~O!d%PX~P(qO_!}O(Q#PO(R!}O(S#PO~O_#QO(S#PO(T#PO(U#QO~Ou#SO!R#TO(]#TO(^#VO~OPYOQYOSfOd!jOe!iOmkOoYOpkOqkOwkOyYO{YO!PWO!TkO!UkO![!eO!fuO!iZO!lYO!mYO!nYO!pvO!r!gO!u!hO$V!kO(O;UO(QTO(TUO([VO(j[O(yiO~O!X#ZO!Y#WO!V(cP!V(qP~P+}O!Z#cO~P`OPYOQYOSfOd!jOe!iOoYOpkOqkOwkOyYO{YO!PWO!TkO!UkO![!eO!fuO!iZO!lYO!mYO!nYO!pvO!r!gO!u!hO$V!kO(QTO(TUO([VO(j[O(yiO~Om#mO!X#iO!y]O#f#lO#g#iO(O;VO!h(nP~P.iO!i#oO(O#nO~O!u#sO!y]O%e#tO~O#h#uO~O!d#vO#h#uO~OP$[OR#zO[$cOo$aO}#yO!P#{O!Y$_O!i#xO!m$[O#O$RO#k$OO#l$PO#m$PO#n$PO#o$QO#p$RO#q$RO#r$bO#s$RO#u$SO#w$UO#y$WO#z$XO([VO(m$YO(t#|O(u#}O~Oa(aX'u(aX's(aX!h(aX!V(aX![(aX%f(aX!d(aX~P1qO#P$dO#]$eO$P$eOP(bXR(bX[(bXo(bX}(bX!P(bX!Y(bX!i(bX!m(bX#O(bX#k(bX#l(bX#m(bX#n(bX#o(bX#p(bX#q(bX#r(bX#s(bX#u(bX#w(bX#y(bX#z(bX([(bX(m(bX(t(bX(u(bX![(bX%f(bX~Oa(bX'u(bX's(bX!V(bX!h(bXs(bX!d(bX~P4UO#]$eO~O$[$hO$^$gO$e$mO~OSfO![$nO$h$oO$j$qO~Oh%VOm%WOo%XOp$tOq$tOw%YOy%ZO{%[O!P${O![$|O!f%aO!i$xO#g%bO$V%_O$r%]O$t%^O$w%`O(O$sO(QTO(TUO([$uO(t$}O(u%POg(XP~O!i%cO~O!P%fO![%gO(O%eO~O!d%kO~Oa%lO'u%lO~O}%pO~P%[O(P!lO~P%[O%k%tO~P%[Oh%VO!i%cO(O%eO(P!lO~Oe%{O!i%cO(O%eO~O#s$RO~O}&QO![%}O!i&PO%g&TO(O%eO(P!lO(QTO(TUO`)SP~O!u#sO~O%p&VO!P)OX![)OX(O)OX~O(O&WO~O!r&]O#t!PO%g!QO%i!OO%j!OO%k!OO%n!RO%p!SO%s!TO%t!TO~Od&bOe&aO!u&_O%e&`O%x&^O~P;|Od&eOeyO![&dO!r&]O!uxO!y]O#t!PO%e}O%i!OO%j!OO%k!OO%n!RO%p!SO%s!TO%t!TO%v!UO~Ob&hO#]&kO%g&fO(P!lO~P=RO!i&lO!r&pO~O!i#oO~O![XO~Oa%lO't&xO'u%lO~Oa%lO't&{O'u%lO~Oa%lO't&}O'u%lO~O's]X!V]Xs]X!h]X&W]X![]X%f]X!d]X~P(qO!_'[O!`'TO!a'TO(P!lO(QTO(TUO~Op'RO!P'QO!X'UO(`'PO!Z(dP!Z(sP~P@YOk'_O![']O(O%eO~Oe'dO!i%cO(O%eO~O}&QO!i&PO~Op!nO!P!oO!y;QO#Q!pO#R!pO#T!pO#U!pO(P!lO(QTO(TUO(`!mO(j!sO~O!_'jO!`'iO!a'iO#S!pO#X'kO#Y'kO~PAtOa%lOh%VO!d#vO!i%cO'u%lO(m'mO~O!m'qO#]'oO~PCSOp!nO!P!oO(QTO(TUO(`!mO(j!sO~O![XOp(hX!P(hX!_(hX!`(hX!a(hX!y(hX#Q(hX#R(hX#S(hX#T(hX#U(hX#X(hX#Y(hX(P(hX(Q(hX(T(hX(`(hX(j(hX~O!`'iO!a'iO(P!lO~PCrO'z'uO'{'uO'|'wO~O_!}O(Q'yO(R!}O(S'yO~O_#QO(S'yO(T'yO(U#QO~Ou#SO!R#TO(]#TO(^'}O~O!X(PO!V'SX!V'YX!Y'SX!Y'YX~P+}O!Y(RO!V(cX~OP$[OR#zO[$cOo$aO}#yO!P#{O!Y(RO!i#xO!m$[O#O$RO#k$OO#l$PO#m$PO#n$PO#o$QO#p$RO#q$RO#r$bO#s$RO#u$SO#w$UO#y$WO#z$XO([VO(m$YO(t#|O(u#}O~O!V(cX~PGfO!V(WO~O!V(pX!Y(pX!d(pX!h(pX(m(pX~O#](pX#h#aX!Z(pX~PIiO#](XO!V(rX!Y(rX~O!Y(YO!V(qX~O!V(]O~O#]$eO~PIiO!Z(^O~P`OR#zO}#yO!P#{O!i#xO([VOP!ka[!kao!ka!Y!ka!m!ka#O!ka#k!ka#l!ka#m!ka#n!ka#o!ka#p!ka#q!ka#r!ka#s!ka#u!ka#w!ka#y!ka#z!ka(m!ka(t!ka(u!ka~Oa!ka'u!ka's!ka!V!ka!h!kas!ka![!ka%f!ka!d!ka~PKPO!h(_O~O!d#vO#](`O(m'mO!Y(oXa(oX'u(oX~O!h(oX~PMlO!P%fO![%gO!y]O#f(eO#g(dO(O%eO~O!Y(fO!h(nX~O!h(hO~O!P%fO![%gO#g(dO(O%eO~OP(bXR(bX[(bXo(bX}(bX!P(bX!Y(bX!i(bX!m(bX#O(bX#k(bX#l(bX#m(bX#n(bX#o(bX#p(bX#q(bX#r(bX#s(bX#u(bX#w(bX#y(bX#z(bX([(bX(m(bX(t(bX(u(bX~O!d#vO!h(bX~P! YOR(jO}(iO!i#xO#P$dO!y!xa!P!xa~O!u!xa%e!xa![!xa#f!xa#g!xa(O!xa~P!#ZO!u(nO~OPYOQYOSfOd!jOe!iOmkOoYOpkOqkOwkOyYO{YO!PWO!TkO!UkO![XO!fuO!iZO!lYO!mYO!nYO!pvO!r!gO!u!hO$V!kO(O!dO(QTO(TUO([VO(j[O(yiO~Oh%VOm%WOo%XOp$tOq$tOw%YOy%ZO{;nO!P${O![$|O!f=OO!i$xO#g;tO$V%_O$r;pO$t;rO$w%`O(O(rO(QTO(TUO([$uO(t$}O(u%PO~O#h(tO~O!X(vO!h(fP~P%[O(`(xO(j[O~O!P(zO!i#xO(`(xO(j[O~OP;POQ;POSfOd<zOe!iOmkOo;POpkOqkOwkOy;PO{;PO!PWO!TkO!UkO![!eO!f;SO!iZO!l;PO!m;PO!n;PO!p;TO!r;WO!u!hO$V!kO(O)XO(QTO(TUO([VO(j[O(y<xO~O!Y$_Oa$oa'u$oa's$oa!h$oa!V$oa![$oa%f$oa!d$oa~O#t)`O~P!&_Oh%VOm%WOo%XOp$tOq$tOw%YOy%ZO{%[O!P${O![$|O!f%aO!i$xO#g%bO$V%_O$r%]O$t%^O$w%`O(O(rO(QTO(TUO([$uO(t$}O(u%PO~Og(kP~P!+hO})eO!d)dO![$]X$Y$]X$[$]X$^$]X$e$]X~O!d)dO![(vX$Y(vX$[(vX$^(vX$e(vX~O})eO~P!-qO})eO![(vX$Y(vX$[(vX$^(vX$e(vX~O![)gO$Y)kO$[)fO$^)fO$e)lO~O!X)oO~P!(oO$[$hO$^$gO$e)sO~Ok$xX}$xX!P$xX#P$xX(t$xX(u$xX~OgjXg$xXkjX!YjX#]jX~P!/gOu)uO(])vO(^)xO~Ok*RO})zO!P){O(t$}O(u%PO~Og)yO~P!0kOg*SO~Oh%VOm%WOo%XOp$tOq$tOw%YOy%ZO{;nO!P*UO![*VO!f=OO!i$xO#g;tO$V%_O$r;pO$t;rO$w%`O(QTO(TUO([$uO(t$}O(u%PO~O!X*YO(O*TO!h(zP~P!1YO#h*[O~O!i*]O~Oh%VOm%WOo%XOp$tOq$tOw%YOy%ZO{;nO!P${O![$|O!f=OO!i$xO#g;tO$V%_O$r;pO$t;rO$w%`O(O*_O(QTO(TUO([$uO(t$}O(u%PO~O!X*bO!V({P~P!3XOo*nO!P*fO!_*lO!`*eO!a*eO!i*]O#X*mO%]*hO(P!lO(`!mO~O!Z*kO~P!4|O#P$dOk(ZX}(ZX!P(ZX(t(ZX(u(ZX!Y(ZX#](ZX~Og(ZX#}(ZX~P!5uOk*sO#]*rOg(YX!Y(YX~O!Y*tOg(XX~O(O&WOg(XP~Op*wO~O!i*|O~O(O(rO~Om+QO!P%fO!X#iO![%gO!y]O#f#lO#g#iO(O%eO!h(nP~O!d#vO#h+RO~O!P%fO!X+TO!Y(YO![%gO(O%eO!V(qP~Op'XO!P+VO!X+UO(QTO(TUO(`(xO~O!Z(sP~P!8uO!Y+WOa)PX'u)PX~OP$[OR#zO[$cOo$aO}#yO!P#{O!i#xO!m$[O#O$RO#k$OO#l$PO#m$PO#n$PO#o$QO#p$RO#q$RO#r$bO#s$RO#u$SO#w$UO#y$WO#z$XO([VO(m$YO(t#|O(u#}O~Oa!ga!Y!ga'u!ga's!ga!V!ga!h!gas!ga![!ga%f!ga!d!ga~P!9mOR#zO}#yO!P#{O!i#xO([VOP!oa[!oao!oa!Y!oa!m!oa#O!oa#k!oa#l!oa#m!oa#n!oa#o!oa#p!oa#q!oa#r!oa#s!oa#u!oa#w!oa#y!oa#z!oa(m!oa(t!oa(u!oa~Oa!oa'u!oa's!oa!V!oa!h!oas!oa![!oa%f!oa!d!oa~P!<TOR#zO}#yO!P#{O!i#xO([VOP!qa[!qao!qa!Y!qa!m!qa#O!qa#k!qa#l!qa#m!qa#n!qa#o!qa#p!qa#q!qa#r!qa#s!qa#u!qa#w!qa#y!qa#z!qa(m!qa(t!qa(u!qa~Oa!qa'u!qa's!qa!V!qa!h!qas!qa![!qa%f!qa!d!qa~P!>kOh%VOk+aO![']O%f+`O~O!d+cOa(WX![(WX'u(WX!Y(WX~Oa%lO![XO'u%lO~Oh%VO!i%cO~Oh%VO!i%cO(O%eO~O!d#vO#h(tO~Ob+nO%g+oO(O+kO(QTO(TUO!Z)TP~O!Y+pO`)SX~O[+tO~O`+uO~O![%}O(O%eO(P!lO`)SP~Oh%VO#]+zO~Oh%VOk+}O![$|O~O![,PO~O},RO![XO~O%k%tO~O!u,WO~Oe,]O~Ob,^O(O#nO(QTO(TUO!Z)RP~Oe%{O~O%g!QO(O&WO~P=RO[,cO`,bO~OPYOQYOSfOdzOeyOmkOoYOpkOqkOwkOyYO{YO!PWO!TkO!UkO!fuO!iZO!lYO!mYO!nYO!pvO!uxO!y]O%e}O(QTO(TUO([VO(j[O(yiO~O![!eO!r!gO$V!kO(O!dO~P!EkO`,bOa%lO'u%lO~OPYOQYOSfOd!jOe!iOmkOoYOpkOqkOwkOyYO{YO!PWO!TkO!UkO![!eO!fuO!iZO!lYO!mYO!nYO!pvO!u!hO$V!kO(O!dO(QTO(TUO([VO(j[O(yiO~Oa,hO!rwO#t!OO%i!OO%j!OO%k!OO~P!HTO!i&lO~O&Y,nO~O![,pO~O&k,rO&m,sOP&haQ&haS&haY&haa&had&hae&ham&hao&hap&haq&haw&hay&ha{&ha!P&ha!T&ha!U&ha![&ha!f&ha!i&ha!l&ha!m&ha!n&ha!p&ha!r&ha!u&ha!y&ha#t&ha$V&ha%e&ha%g&ha%i&ha%j&ha%k&ha%n&ha%p&ha%s&ha%t&ha%v&ha&S&ha&Y&ha&[&ha&^&ha&`&ha&c&ha&i&ha&o&ha&q&ha&s&ha&u&ha&w&ha's&ha(O&ha(Q&ha(T&ha([&ha(j&ha(y&ha!Z&ha&a&hab&ha&f&ha~O(O,xO~Oh!bX!Y!OX!Z!OX!d!OX!d!bX!i!bX#]!OX~O!Y!bX!Z!bX~P# ZO!d,}O#],|Oh(eX!Y#eX!Y(eX!Z#eX!Z(eX!d(eX!i(eX~Oh%VO!d-PO!i%cO!Y!^X!Z!^X~Op!nO!P!oO(QTO(TUO(`!mO~OP;POQ;POSfOd<zOe!iOmkOo;POpkOqkOwkOy;PO{;PO!PWO!TkO!UkO![!eO!f;SO!iZO!l;PO!m;PO!n;PO!p;TO!r;WO!u!hO$V!kO(QTO(TUO([VO(j[O(y<xO~O(O;zO~P##_O!Y-TO!Z(dX~O!Z-VO~O!d,}O#],|O!Y#eX!Z#eX~O!Y-WO!Z(sX~O!Z-YO~O!`-ZO!a-ZO(P!lO~P#!|O!Z-^O~P'_Ok-aO![']O~O!V-fO~Op!xa!_!xa!`!xa!a!xa#Q!xa#R!xa#S!xa#T!xa#U!xa#X!xa#Y!xa(P!xa(Q!xa(T!xa(`!xa(j!xa~P!#ZO!m-kO#]-iO~PCSO!`-mO!a-mO(P!lO~PCrOa%lO#]-iO'u%lO~Oa%lO!d#vO#]-iO'u%lO~Oa%lO!d#vO!m-kO#]-iO'u%lO(m'mO~O'z'uO'{'uO'|-rO~Os-sO~O!V'Sa!Y'Sa~P!9mO!X-wO!V'SX!Y'SX~P%[O!Y(RO!V(ca~O!V(ca~PGfO!Y(YO!V(qa~O!P%fO!X-{O![%gO(O%eO!V'YX!Y'YX~O#]-}O!Y(oa!h(oaa(oa'u(oa~O!d#vO~P#+eO!Y(fO!h(na~O!P%fO![%gO#g.RO(O%eO~Om.WO!P%fO!X.TO![%gO!y]O#f.VO#g.TO(O%eO!Y']X!h']X~OR.[O!i#xO~Oh%VOk._O![']O%f.^O~Oa#`i!Y#`i'u#`i's#`i!V#`i!h#`is#`i![#`i%f#`i!d#`i~P!9mOk=UO})zO!P){O(t$}O(u%PO~O#h#[aa#[a#]#[a'u#[a!Y#[a!h#[a![#[a!V#[a~P#.aO#h(ZXP(ZXR(ZX[(ZXa(ZXo(ZX!i(ZX!m(ZX#O(ZX#k(ZX#l(ZX#m(ZX#n(ZX#o(ZX#p(ZX#q(ZX#r(ZX#s(ZX#u(ZX#w(ZX#y(ZX#z(ZX'u(ZX([(ZX(m(ZX!h(ZX!V(ZX's(ZXs(ZX![(ZX%f(ZX!d(ZX~P!5uO!Y.lO!h(fX~P!9mO!h.oO~O!V.qO~OP$[OR#zO}#yO!P#{O!i#xO!m$[O([VO[#jia#jio#ji!Y#ji#O#ji#l#ji#m#ji#n#ji#o#ji#p#ji#q#ji#r#ji#s#ji#u#ji#w#ji#y#ji#z#ji'u#ji(m#ji(t#ji(u#ji's#ji!V#ji!h#jis#ji![#ji%f#ji!d#ji~O#k#ji~P#1|O#k$OO~P#1|OP$[OR#zOo$aO}#yO!P#{O!i#xO!m$[O#k$OO#l$PO#m$PO#n$PO([VO[#jia#ji!Y#ji#O#ji#p#ji#q#ji#r#ji#s#ji#u#ji#w#ji#y#ji#z#ji'u#ji(m#ji(t#ji(u#ji's#ji!V#ji!h#jis#ji![#ji%f#ji!d#ji~O#o#ji~P#4kO#o$QO~P#4kOP$[OR#zO[$cOo$aO}#yO!P#{O!i#xO!m$[O#O$RO#k$OO#l$PO#m$PO#n$PO#o$QO#p$RO#q$RO#r$bO#s$RO([VOa#ji!Y#ji#w#ji#y#ji#z#ji'u#ji(m#ji(t#ji(u#ji's#ji!V#ji!h#jis#ji![#ji%f#ji!d#ji~O#u#ji~P#7YOP$[OR#zO[$cOo$aO}#yO!P#{O!i#xO!m$[O#O$RO#k$OO#l$PO#m$PO#n$PO#o$QO#p$RO#q$RO#r$bO#s$RO#u$SO([VO(u#}Oa#ji!Y#ji#y#ji#z#ji'u#ji(m#ji(t#ji's#ji!V#ji!h#jis#ji![#ji%f#ji!d#ji~O#w$UO~P#9pO#w#ji~P#9pO#u$SO~P#7YOP$[OR#zO[$cOo$aO}#yO!P#{O!i#xO!m$[O#O$RO#k$OO#l$PO#m$PO#n$PO#o$QO#p$RO#q$RO#r$bO#s$RO#u$SO#w$UO([VO(t#|O(u#}Oa#ji!Y#ji#z#ji'u#ji(m#ji's#ji!V#ji!h#jis#ji![#ji%f#ji!d#ji~O#y#ji~P#<fO#y$WO~P#<fOP]XR]X[]Xo]X}]X!P]X!i]X!m]X#O]X#P]X#]]X#hfX#k]X#l]X#m]X#n]X#o]X#p]X#q]X#r]X#s]X#u]X#w]X#y]X#z]X$P]X([]X(m]X(t]X(u]X!Y]X!Z]X~O#}]X~P#?TOP$[OR#zO[;hOo;fO}#yO!P#{O!i#xO!m$[O#O;]O#k;YO#l;ZO#m;ZO#n;ZO#o;[O#p;]O#q;]O#r;gO#s;]O#u;^O#w;`O#y;bO#z;cO([VO(m$YO(t#|O(u#}O~O#}.sO~P#AbO#P$dO#];iO$P;iO#}(bX!Z(bX~P! YOa'`a!Y'`a'u'`a's'`a!h'`a!V'`as'`a!['`a%f'`a!d'`a~P!9mO[#jia#jio#ji!Y#ji#O#ji#o#ji#p#ji#q#ji#r#ji#s#ji#u#ji#w#ji#y#ji#z#ji'u#ji(m#ji's#ji!V#ji!h#jis#ji![#ji%f#ji!d#ji~OP$[OR#zO}#yO!P#{O!i#xO!m$[O#k$OO#l$PO#m$PO#n$PO([VO(t#ji(u#ji~P#DdOk=UO})zO!P){O(t$}O(u%POP#jiR#ji!i#ji!m#ji#k#ji#l#ji#m#ji#n#ji([#ji~P#DdO!Y.wOg(kX~P!0kOg.yO~Oa$Oi!Y$Oi'u$Oi's$Oi!V$Oi!h$Ois$Oi![$Oi%f$Oi!d$Oi~P!9mO$[.zO$^.zO~O$[.{O$^.{O~O!d)dO#].|O![$bX$Y$bX$[$bX$^$bX$e$bX~O!X.}O~O![)gO$Y/PO$[)fO$^)fO$e/QO~O!Y;dO!Z(aX~P#AbO!Z/RO~O!d)dO$e(vX~O$e/TO~Ou)uO(])vO(^/WO~O!V/[O~P!&_O(t$}Ok%^a}%^a!P%^a(u%^a!Y%^a#]%^a~Og%^a#}%^a~P#K^O(u%POk%`a}%`a!P%`a(t%`a!Y%`a#]%`a~Og%`a#}%`a~P#LPO!YfX!dfX!hfX!h$xX(mfX~P!/gO!X/eO!Y(YO(O/dO!V(qP!V({P~P!1YOo*nO!_*lO!`*eO!a*eO!i*]O#X*mO%]*hO(P!lO~Op'XO!P/fO!X+UO!Z*kO(QTO(TUO(`;wO!Z(sP~P#MjO!h/gO~P#.aO!Y/hO!d#vO(m'mO!h(zX~O!h/mO~O!P%fO!X*YO![%gO(O%eO!h(zP~O#h/oO~O!V$xX!Y$xX!d%PX~P!/gO!Y/pO!V({X~P#.aO!d/rO~O!V/tO~Oh%VOo/xO!d#vO!i%cO(m'mO~O(O/zO~O!d+cO~Oa%lO!Y0OO'u%lO~O!Z0QO~P!4|O!`0RO!a0RO(P!lO(`!mO~O!P0TO(`!mO~O#X0UO~Og%^a!Y%^a#]%^a#}%^a~P!0kOg%`a!Y%`a#]%`a#}%`a~P!0kO(O&WOg'iX!Y'iX~O!Y*tOg(Xa~Og0_O~OR0`O}0`O!P0aO#P$dOkza(tza(uza!Yza#]za~Ogza#}za~P$%]O})zO!P){Ok$qa(t$qa(u$qa!Y$qa#]$qa~Og$qa#}$qa~P$&UO})zO!P){Ok$sa(t$sa(u$sa!Y$sa#]$sa~Og$sa#}$sa~P$&wO#h0dO~Og%Ra!Y%Ra#]%Ra#}%Ra~P!0kO!d#vO~O#h0gO~O!Y+WOa)Pa'u)Pa~OR#zO}#yO!P#{O!i#xO([VOP!oi[!oio!oi!Y!oi!m!oi#O!oi#k!oi#l!oi#m!oi#n!oi#o!oi#p!oi#q!oi#r!oi#s!oi#u!oi#w!oi#y!oi#z!oi(m!oi(t!oi(u!oi~Oa!oi'u!oi's!oi!V!oi!h!ois!oi![!oi%f!oi!d!oi~P$(fOh%VOo%XOp$tOq$tOw%YOy%ZO{;nO!P${O![$|O!f=OO!i$xO#g;tO$V%_O$r;pO$t;rO$w%`O(QTO(TUO([$uO(t$}O(u%PO~Om0pO(O0oO~P$*|O!d+cOa(Wa![(Wa'u(Wa!Y(Wa~O#h0vO~O[]X!YfX!ZfX~O!Y0wO!Z)TX~O!Z0yO~O[0zO~Ob0|O(O+kO(QTO(TUO~O![%}O(O%eO`'qX!Y'qX~O!Y+pO`)Sa~O!h1PO~P!9mO[1SO~O`1TO~O#]1WO~Ok1ZO![$|O~O(`(xO!Z)QP~Oh%VOk1dO![1aO%f1cO~O[1nO!Y1lO!Z)RX~O!Z1oO~O`1qOa%lO'u%lO~O(O#nO(QTO(TUO~O#P$dO#]$eO$P$eOP(bXR(bX[(bXo(bX}(bX!P(bX!Y(bX!i(bX!m(bX#O(bX#k(bX#l(bX#m(bX#n(bX#o(bX#p(bX#q(bX#r(bX#u(bX#w(bX#y(bX#z(bX([(bX(m(bX(t(bX(u(bX~O#s1tO&W1uOa(bX~P$0dO#]$eO#s1tO&W1uO~Oa1wO~P%[Oa1yO~O&a1|OP&_iQ&_iS&_iY&_ia&_id&_ie&_im&_io&_ip&_iq&_iw&_iy&_i{&_i!P&_i!T&_i!U&_i![&_i!f&_i!i&_i!l&_i!m&_i!n&_i!p&_i!r&_i!u&_i!y&_i#t&_i$V&_i%e&_i%g&_i%i&_i%j&_i%k&_i%n&_i%p&_i%s&_i%t&_i%v&_i&S&_i&Y&_i&[&_i&^&_i&`&_i&c&_i&i&_i&o&_i&q&_i&s&_i&u&_i&w&_i's&_i(O&_i(Q&_i(T&_i([&_i(j&_i(y&_i!Z&_ib&_i&f&_i~Ob2SO!Z2QO&f2RO~P`O![XO!i2UO~O&m,sOP&hiQ&hiS&hiY&hia&hid&hie&him&hio&hip&hiq&hiw&hiy&hi{&hi!P&hi!T&hi!U&hi![&hi!f&hi!i&hi!l&hi!m&hi!n&hi!p&hi!r&hi!u&hi!y&hi#t&hi$V&hi%e&hi%g&hi%i&hi%j&hi%k&hi%n&hi%p&hi%s&hi%t&hi%v&hi&S&hi&Y&hi&[&hi&^&hi&`&hi&c&hi&i&hi&o&hi&q&hi&s&hi&u&hi&w&hi's&hi(O&hi(Q&hi(T&hi([&hi(j&hi(y&hi!Z&hi&a&hib&hi&f&hi~O!V2[O~O!Y!^a!Z!^a~P#AbOp!nO!P!oO!X2bO(`!mO!Y'TX!Z'TX~P@YO!Y-TO!Z(da~O!Y'ZX!Z'ZX~P!8uO!Y-WO!Z(sa~O!Z2iO~P'_Oa%lO#]2rO'u%lO~Oa%lO!d#vO#]2rO'u%lO~Oa%lO!d#vO!m2vO#]2rO'u%lO(m'mO~Oa%lO'u%lO~P!9mO!Y$_Os$oa~O!V'Si!Y'Si~P!9mO!Y(RO!V(ci~O!Y(YO!V(qi~O!V(ri!Y(ri~P!9mO!Y(oi!h(oia(oi'u(oi~P!9mO#]2xO!Y(oi!h(oia(oi'u(oi~O!Y(fO!h(ni~O!P%fO![%gO!y]O#f2}O#g2|O(O%eO~O!P%fO![%gO#g2|O(O%eO~Ok3UO![']O%f3TO~Oh%VOk3UO![']O%f3TO~O#h%^aP%^aR%^a[%^aa%^ao%^a!i%^a!m%^a#O%^a#k%^a#l%^a#m%^a#n%^a#o%^a#p%^a#q%^a#r%^a#s%^a#u%^a#w%^a#y%^a#z%^a'u%^a([%^a(m%^a!h%^a!V%^a's%^as%^a![%^a%f%^a!d%^a~P#K^O#h%`aP%`aR%`a[%`aa%`ao%`a!i%`a!m%`a#O%`a#k%`a#l%`a#m%`a#n%`a#o%`a#p%`a#q%`a#r%`a#s%`a#u%`a#w%`a#y%`a#z%`a'u%`a([%`a(m%`a!h%`a!V%`a's%`as%`a![%`a%f%`a!d%`a~P#LPO#h%^aP%^aR%^a[%^aa%^ao%^a!Y%^a!i%^a!m%^a#O%^a#k%^a#l%^a#m%^a#n%^a#o%^a#p%^a#q%^a#r%^a#s%^a#u%^a#w%^a#y%^a#z%^a'u%^a([%^a(m%^a!h%^a!V%^a's%^a#]%^as%^a![%^a%f%^a!d%^a~P#.aO#h%`aP%`aR%`a[%`aa%`ao%`a!Y%`a!i%`a!m%`a#O%`a#k%`a#l%`a#m%`a#n%`a#o%`a#p%`a#q%`a#r%`a#s%`a#u%`a#w%`a#y%`a#z%`a'u%`a([%`a(m%`a!h%`a!V%`a's%`a#]%`as%`a![%`a%f%`a!d%`a~P#.aO#hzaPza[zaazaoza!iza!mza#Oza#kza#lza#mza#nza#oza#pza#qza#rza#sza#uza#wza#yza#zza'uza([za(mza!hza!Vza'szasza![za%fza!dza~P$%]O#h$qaP$qaR$qa[$qaa$qao$qa!i$qa!m$qa#O$qa#k$qa#l$qa#m$qa#n$qa#o$qa#p$qa#q$qa#r$qa#s$qa#u$qa#w$qa#y$qa#z$qa'u$qa([$qa(m$qa!h$qa!V$qa's$qas$qa![$qa%f$qa!d$qa~P$&UO#h$saP$saR$sa[$saa$sao$sa!i$sa!m$sa#O$sa#k$sa#l$sa#m$sa#n$sa#o$sa#p$sa#q$sa#r$sa#s$sa#u$sa#w$sa#y$sa#z$sa'u$sa([$sa(m$sa!h$sa!V$sa's$sas$sa![$sa%f$sa!d$sa~P$&wO#h%RaP%RaR%Ra[%Raa%Rao%Ra!Y%Ra!i%Ra!m%Ra#O%Ra#k%Ra#l%Ra#m%Ra#n%Ra#o%Ra#p%Ra#q%Ra#r%Ra#s%Ra#u%Ra#w%Ra#y%Ra#z%Ra'u%Ra([%Ra(m%Ra!h%Ra!V%Ra's%Ra#]%Ras%Ra![%Ra%f%Ra!d%Ra~P#.aOa#`q!Y#`q'u#`q's#`q!V#`q!h#`qs#`q![#`q%f#`q!d#`q~P!9mO!X3^O!Y'UX!h'UX~P%[O!Y.lO!h(fa~O!Y.lO!h(fa~P!9mO!V3aO~O#}!ka!Z!ka~PKPO#}!ga!Y!ga!Z!ga~P#AbO#}!oa!Z!oa~P!<TO#}!qa!Z!qa~P!>kOg'XX!Y'XX~P!+hO!Y.wOg(ka~OSfO![3uO$c3vO~O!Z3zO~Os3{O~P#.aOa$lq!Y$lq'u$lq's$lq!V$lq!h$lqs$lq![$lq%f$lq!d$lq~P!9mO!V3|O~P#.aO})zO!P){O(u%POk'ea(t'ea!Y'ea#]'ea~Og'ea#}'ea~P%)nO})zO!P){Ok'ga(t'ga(u'ga!Y'ga#]'ga~Og'ga#}'ga~P%*aO(m$YO~P#.aO!VfX!V$xX!YfX!Y$xX!d%PX#]fX~P!/gO(O<QO~P!1YOmkO(O4OO~P.iO!P%fO!X4QO![%gO(O%eO!Y'aX!h'aX~O!Y/hO!h(za~O!Y/hO!d#vO!h(za~O!Y/hO!d#vO(m'mO!h(za~Og$zi!Y$zi#]$zi#}$zi~P!0kO!X4YO!V'cX!Y'cX~P!3XO!Y/pO!V({a~O!Y/pO!V({a~P#.aO!d#vO#s4bO~Oo4eO!d#vO(m'mO~O!P4hO(`!mO~O(t$}Ok%^i}%^i!P%^i(u%^i!Y%^i#]%^i~Og%^i#}%^i~P%.wO(u%POk%`i}%`i!P%`i(t%`i!Y%`i#]%`i~Og%`i#}%`i~P%/jOg(Yi!Y(Yi~P!0kO#]4mOg(Yi!Y(Yi~P!0kO!h4pO~Oa$mq!Y$mq'u$mq's$mq!V$mq!h$mqs$mq![$mq%f$mq!d$mq~P!9mO!V4tO~O!Y4uO![(|X~P#.aOa$xX![$xX%Z]X'u$xX!Y$xX~P!/gO%Z4xOalXklX}lX!PlX![lX'ulX(tlX(ulX!YlX~O%Z4xO~Ob5OO%g5PO(O+kO(QTO(TUO!Y'pX!Z'pX~O!Y0wO!Z)Ta~O[5TO~O`5UO~Oa%lO'u%lO~P#.aO![$|O~P#.aO!Y5^O#]5`O!Z)QX~O!Z5aO~Oo5hOp!nO!P5bO!_!yO!`!vO!a!vO!y;QO#Q!pO#R!pO#S!pO#T!pO#U!pO#X5gO#Y!zO(P!lO(QTO(TUO(`!mO(j!sO~O!Z5fO~P%4tOk5mO![1aO%f5lO~Oh%VOk5mO![1aO%f5lO~Ob5tO(O#nO(QTO(TUO!Y'oX!Z'oX~O!Y1lO!Z)Ra~O(QTO(TUO(`5vO~O`5zO~O#s5}O&W6OO~PMlO!h6PO~P%[Oa6RO~Oa6RO~P%[Ob2SO!Z6WO&f2RO~P`O!d6YO~O!d6[Oh(ei!Y(ei!Z(ei!d(ei!i(ei~O!Y#ei!Z#ei~P#AbO#]6]O!Y#ei!Z#ei~O!Y!^i!Z!^i~P#AbOa%lO#]6fO'u%lO~Oa%lO!d#vO#]6fO'u%lO~O!Y(oq!h(oqa(oq'u(oq~P!9mO!Y(fO!h(nq~O!P%fO![%gO#g6mO(O%eO~O![']O%f6pO~Ok6tO![']O%f6pO~O#h'eaP'eaR'ea['eaa'eao'ea!i'ea!m'ea#O'ea#k'ea#l'ea#m'ea#n'ea#o'ea#p'ea#q'ea#r'ea#s'ea#u'ea#w'ea#y'ea#z'ea'u'ea(['ea(m'ea!h'ea!V'ea's'eas'ea!['ea%f'ea!d'ea~P%)nO#h'gaP'gaR'ga['gaa'gao'ga!i'ga!m'ga#O'ga#k'ga#l'ga#m'ga#n'ga#o'ga#p'ga#q'ga#r'ga#s'ga#u'ga#w'ga#y'ga#z'ga'u'ga(['ga(m'ga!h'ga!V'ga's'gas'ga!['ga%f'ga!d'ga~P%*aO#h$ziP$ziR$zi[$zia$zio$zi!Y$zi!i$zi!m$zi#O$zi#k$zi#l$zi#m$zi#n$zi#o$zi#p$zi#q$zi#r$zi#s$zi#u$zi#w$zi#y$zi#z$zi'u$zi([$zi(m$zi!h$zi!V$zi's$zi#]$zis$zi![$zi%f$zi!d$zi~P#.aO#h%^iP%^iR%^i[%^ia%^io%^i!i%^i!m%^i#O%^i#k%^i#l%^i#m%^i#n%^i#o%^i#p%^i#q%^i#r%^i#s%^i#u%^i#w%^i#y%^i#z%^i'u%^i([%^i(m%^i!h%^i!V%^i's%^is%^i![%^i%f%^i!d%^i~P%.wO#h%`iP%`iR%`i[%`ia%`io%`i!i%`i!m%`i#O%`i#k%`i#l%`i#m%`i#n%`i#o%`i#p%`i#q%`i#r%`i#s%`i#u%`i#w%`i#y%`i#z%`i'u%`i([%`i(m%`i!h%`i!V%`i's%`is%`i![%`i%f%`i!d%`i~P%/jO!Y'Ua!h'Ua~P!9mO!Y.lO!h(fi~O#}#`i!Y#`i!Z#`i~P#AbOP$[OR#zO}#yO!P#{O!i#xO!m$[O([VO[#jio#ji#O#ji#l#ji#m#ji#n#ji#o#ji#p#ji#q#ji#r#ji#s#ji#u#ji#w#ji#y#ji#z#ji#}#ji(m#ji(t#ji(u#ji!Y#ji!Z#ji~O#k#ji~P%G^O#k;YO~P%G^OP$[OR#zOo;fO}#yO!P#{O!i#xO!m$[O#k;YO#l;ZO#m;ZO#n;ZO([VO[#ji#O#ji#p#ji#q#ji#r#ji#s#ji#u#ji#w#ji#y#ji#z#ji#}#ji(m#ji(t#ji(u#ji!Y#ji!Z#ji~O#o#ji~P%IfO#o;[O~P%IfOP$[OR#zO[;hOo;fO}#yO!P#{O!i#xO!m$[O#O;]O#k;YO#l;ZO#m;ZO#n;ZO#o;[O#p;]O#q;]O#r;gO#s;]O([VO#w#ji#y#ji#z#ji#}#ji(m#ji(t#ji(u#ji!Y#ji!Z#ji~O#u#ji~P%KnOP$[OR#zO[;hOo;fO}#yO!P#{O!i#xO!m$[O#O;]O#k;YO#l;ZO#m;ZO#n;ZO#o;[O#p;]O#q;]O#r;gO#s;]O#u;^O([VO(u#}O#y#ji#z#ji#}#ji(m#ji(t#ji!Y#ji!Z#ji~O#w;`O~P%MoO#w#ji~P%MoO#u;^O~P%KnOP$[OR#zO[;hOo;fO}#yO!P#{O!i#xO!m$[O#O;]O#k;YO#l;ZO#m;ZO#n;ZO#o;[O#p;]O#q;]O#r;gO#s;]O#u;^O#w;`O([VO(t#|O(u#}O#z#ji#}#ji(m#ji!Y#ji!Z#ji~O#y#ji~P&!OO#y;bO~P&!OOa#{y!Y#{y'u#{y's#{y!V#{y!h#{ys#{y![#{y%f#{y!d#{y~P!9mO[#jio#ji#O#ji#o#ji#p#ji#q#ji#r#ji#s#ji#u#ji#w#ji#y#ji#z#ji#}#ji(m#ji!Y#ji!Z#ji~OP$[OR#zO}#yO!P#{O!i#xO!m$[O#k;YO#l;ZO#m;ZO#n;ZO([VO(t#ji(u#ji~P&$zOk=VO})zO!P){O(t$}O(u%POP#jiR#ji!i#ji!m#ji#k#ji#l#ji#m#ji#n#ji([#ji~P&$zO#P$dOP(ZXR(ZX[(ZXk(ZXo(ZX}(ZX!P(ZX!i(ZX!m(ZX#O(ZX#k(ZX#l(ZX#m(ZX#n(ZX#o(ZX#p(ZX#q(ZX#r(ZX#s(ZX#u(ZX#w(ZX#y(ZX#z(ZX#}(ZX([(ZX(m(ZX(t(ZX(u(ZX!Y(ZX!Z(ZX~O#}$Oi!Y$Oi!Z$Oi~P#AbO#}!oi!Z!oi~P$(fOg'Xa!Y'Xa~P!0kO!Z7WO~O!Y'`a!Z'`a~P#AbOP]XR]X[]Xo]X}]X!P]X!V]X!Y]X!i]X!m]X#O]X#P]X#]]X#hfX#k]X#l]X#m]X#n]X#o]X#p]X#q]X#r]X#s]X#u]X#w]X#y]X#z]X$P]X([]X(m]X(t]X(u]X~O!d%WX#s%WX~P&+QO!d#vO(m'mO!Y'aa!h'aa~O!Y/hO!h(zi~O!Y/hO!d#vO!h(zi~Og$zq!Y$zq#]$zq#}$zq~P!0kO!V'ca!Y'ca~P#.aO!d7_O~O!Y/pO!V({i~P#.aO!Y/pO!V({i~O!V7cO~O!d#vO#s7hO~Oo7iO!d#vO(m'mO~O})zO!P){O(u%POk'fa(t'fa!Y'fa#]'fa~Og'fa#}'fa~P&/pO})zO!P){Ok'ha(t'ha(u'ha!Y'ha#]'ha~Og'ha#}'ha~P&0cO!V7lO~Og$|q!Y$|q#]$|q#}$|q~P!0kOa$my!Y$my'u$my's$my!V$my!h$mys$my![$my%f$my!d$my~P!9mO!d6[O~O!Y4uO![(|a~O![']OP$SaR$Sa[$Sao$Sa}$Sa!P$Sa!Y$Sa!i$Sa!m$Sa#O$Sa#k$Sa#l$Sa#m$Sa#n$Sa#o$Sa#p$Sa#q$Sa#r$Sa#s$Sa#u$Sa#w$Sa#y$Sa#z$Sa([$Sa(m$Sa(t$Sa(u$Sa~O%f6pO~P&2lOa#`y!Y#`y'u#`y's#`y!V#`y!h#`ys#`y![#`y%f#`y!d#`y~P!9mO[7qO~Ob7sO(O+kO(QTO(TUO~O!Y0wO!Z)Ti~O`7wO~O(`(xO!Y'lX!Z'lX~O!Y5^O!Z)Qa~O!Z8QO~P%4tOp!nO!P8RO(QTO(TUO(`!mO(j!sO~O#X8SO~O![1aO~O![1aO%f8UO~Ok8XO![1aO%f8UO~O[8^O!Y'oa!Z'oa~O!Y1lO!Z)Ri~O!h8bO~O!h8cO~O!h8fO~O!h8fO~P%[Oa8hO~O!d8iO~O!h8jO~O!Y(ri!Z(ri~P#AbOa%lO#]8rO'u%lO~O!Y(oy!h(oya(oy'u(oy~P!9mO!Y(fO!h(ny~O%f8uO~P&2lO![']O%f8uO~O#h$zqP$zqR$zq[$zqa$zqo$zq!Y$zq!i$zq!m$zq#O$zq#k$zq#l$zq#m$zq#n$zq#o$zq#p$zq#q$zq#r$zq#s$zq#u$zq#w$zq#y$zq#z$zq'u$zq([$zq(m$zq!h$zq!V$zq's$zq#]$zqs$zq![$zq%f$zq!d$zq~P#.aO#h'faP'faR'fa['faa'fao'fa!i'fa!m'fa#O'fa#k'fa#l'fa#m'fa#n'fa#o'fa#p'fa#q'fa#r'fa#s'fa#u'fa#w'fa#y'fa#z'fa'u'fa(['fa(m'fa!h'fa!V'fa's'fas'fa!['fa%f'fa!d'fa~P&/pO#h'haP'haR'ha['haa'hao'ha!i'ha!m'ha#O'ha#k'ha#l'ha#m'ha#n'ha#o'ha#p'ha#q'ha#r'ha#s'ha#u'ha#w'ha#y'ha#z'ha'u'ha(['ha(m'ha!h'ha!V'ha's'has'ha!['ha%f'ha!d'ha~P&0cO#h$|qP$|qR$|q[$|qa$|qo$|q!Y$|q!i$|q!m$|q#O$|q#k$|q#l$|q#m$|q#n$|q#o$|q#p$|q#q$|q#r$|q#s$|q#u$|q#w$|q#y$|q#z$|q'u$|q([$|q(m$|q!h$|q!V$|q's$|q#]$|qs$|q![$|q%f$|q!d$|q~P#.aO!Y'Ui!h'Ui~P!9mO#}#`q!Y#`q!Z#`q~P#AbO(t$}OP%^aR%^a[%^ao%^a!i%^a!m%^a#O%^a#k%^a#l%^a#m%^a#n%^a#o%^a#p%^a#q%^a#r%^a#s%^a#u%^a#w%^a#y%^a#z%^a#}%^a([%^a(m%^a!Y%^a!Z%^a~Ok%^a}%^a!P%^a(u%^a~P&CoO(u%POP%`aR%`a[%`ao%`a!i%`a!m%`a#O%`a#k%`a#l%`a#m%`a#n%`a#o%`a#p%`a#q%`a#r%`a#s%`a#u%`a#w%`a#y%`a#z%`a#}%`a([%`a(m%`a!Y%`a!Z%`a~Ok%`a}%`a!P%`a(t%`a~P&EsOk=VO})zO!P){O(u%PO~P&CoOk=VO})zO!P){O(t$}O~P&EsOR0`O}0`O!P0aO#P$dOPza[zakzaoza!iza!mza#Oza#kza#lza#mza#nza#oza#pza#qza#rza#sza#uza#wza#yza#zza#}za([za(mza(tza(uza!Yza!Zza~O})zO!P){OP$qaR$qa[$qak$qao$qa!i$qa!m$qa#O$qa#k$qa#l$qa#m$qa#n$qa#o$qa#p$qa#q$qa#r$qa#s$qa#u$qa#w$qa#y$qa#z$qa#}$qa([$qa(m$qa(t$qa(u$qa!Y$qa!Z$qa~O})zO!P){OP$saR$sa[$sak$sao$sa!i$sa!m$sa#O$sa#k$sa#l$sa#m$sa#n$sa#o$sa#p$sa#q$sa#r$sa#s$sa#u$sa#w$sa#y$sa#z$sa#}$sa([$sa(m$sa(t$sa(u$sa!Y$sa!Z$sa~Ok=VO})zO!P){O(t$}O(u%PO~OP%RaR%Ra[%Rao%Ra!i%Ra!m%Ra#O%Ra#k%Ra#l%Ra#m%Ra#n%Ra#o%Ra#p%Ra#q%Ra#r%Ra#s%Ra#u%Ra#w%Ra#y%Ra#z%Ra#}%Ra([%Ra(m%Ra!Y%Ra!Z%Ra~P&NlO#}$lq!Y$lq!Z$lq~P#AbO#}$mq!Y$mq!Z$mq~P#AbO!Z9SO~O#}9TO~P!0kO!d#vO!Y'ai!h'ai~O!d#vO(m'mO!Y'ai!h'ai~O!Y/hO!h(zq~O!V'ci!Y'ci~P#.aO!Y/pO!V({q~Oo9[O!d#vO(m'mO~O!V9]O~P#.aO!V9]O~O!d#vO#s9bO~Og(Yy!Y(Yy~P!0kO!Y'ja!['ja~P#.aOa%Yq![%Yq'u%Yq!Y%Yq~P#.aO[9dO~O!Y0wO!Z)Tq~O#]9hO!Y'la!Z'la~O!Y5^O!Z)Qi~P#AbO!P4hO~O![1aO%f9lO~O(QTO(TUO(`9qO~O!Y1lO!Z)Rq~O!h9tO~O!h9uO~O!h9vO~O!h9vO~P%[O#]9yO!Y#ey!Z#ey~O!Y#ey!Z#ey~P#AbO%f:OO~P&2lO![']O%f:OO~O#}#{y!Y#{y!Z#{y~P#AbOP$ziR$zi[$zio$zi!i$zi!m$zi#O$zi#k$zi#l$zi#m$zi#n$zi#o$zi#p$zi#q$zi#r$zi#s$zi#u$zi#w$zi#y$zi#z$zi#}$zi([$zi(m$zi!Y$zi!Z$zi~P&NlO})zO!P){O(u%POP'eaR'ea['eak'eao'ea!i'ea!m'ea#O'ea#k'ea#l'ea#m'ea#n'ea#o'ea#p'ea#q'ea#r'ea#s'ea#u'ea#w'ea#y'ea#z'ea#}'ea(['ea(m'ea(t'ea!Y'ea!Z'ea~O})zO!P){OP'gaR'ga['gak'gao'ga!i'ga!m'ga#O'ga#k'ga#l'ga#m'ga#n'ga#o'ga#p'ga#q'ga#r'ga#s'ga#u'ga#w'ga#y'ga#z'ga#}'ga(['ga(m'ga(t'ga(u'ga!Y'ga!Z'ga~O(t$}OP%^iR%^i[%^ik%^io%^i}%^i!P%^i!i%^i!m%^i#O%^i#k%^i#l%^i#m%^i#n%^i#o%^i#p%^i#q%^i#r%^i#s%^i#u%^i#w%^i#y%^i#z%^i#}%^i([%^i(m%^i(u%^i!Y%^i!Z%^i~O(u%POP%`iR%`i[%`ik%`io%`i}%`i!P%`i!i%`i!m%`i#O%`i#k%`i#l%`i#m%`i#n%`i#o%`i#p%`i#q%`i#r%`i#s%`i#u%`i#w%`i#y%`i#z%`i#}%`i([%`i(m%`i(t%`i!Y%`i!Z%`i~O#}$my!Y$my!Z$my~P#AbO#}#`y!Y#`y!Z#`y~P#AbO!d#vO!Y'aq!h'aq~O!Y/hO!h(zy~O!V'cq!Y'cq~P#.aOo:YO!d#vO(m'mO~O!V:ZO~P#.aO!V:ZO~O!Y0wO!Z)Ty~O!Y5^O!Z)Qq~O![1aO%f:cO~O!h:fO~O%f:kO~P&2lOP$zqR$zq[$zqo$zq!i$zq!m$zq#O$zq#k$zq#l$zq#m$zq#n$zq#o$zq#p$zq#q$zq#r$zq#s$zq#u$zq#w$zq#y$zq#z$zq#}$zq([$zq(m$zq!Y$zq!Z$zq~P&NlO})zO!P){O(u%POP'faR'fa['fak'fao'fa!i'fa!m'fa#O'fa#k'fa#l'fa#m'fa#n'fa#o'fa#p'fa#q'fa#r'fa#s'fa#u'fa#w'fa#y'fa#z'fa#}'fa(['fa(m'fa(t'fa!Y'fa!Z'fa~O})zO!P){OP'haR'ha['hak'hao'ha!i'ha!m'ha#O'ha#k'ha#l'ha#m'ha#n'ha#o'ha#p'ha#q'ha#r'ha#s'ha#u'ha#w'ha#y'ha#z'ha#}'ha(['ha(m'ha(t'ha(u'ha!Y'ha!Z'ha~OP$|qR$|q[$|qo$|q!i$|q!m$|q#O$|q#k$|q#l$|q#m$|q#n$|q#o$|q#p$|q#q$|q#r$|q#s$|q#u$|q#w$|q#y$|q#z$|q#}$|q([$|q(m$|q!Y$|q!Z$|q~P&NlOg%b!Z!Y%b!Z#]%b!Z#}%b!Z~P!0kOo:oO!d#vO(m'mO~O!V:pO~P#.aO!Y'lq!Z'lq~P#AbO!Y#e!Z!Z#e!Z~P#AbO#h%b!ZP%b!ZR%b!Z[%b!Za%b!Zo%b!Z!Y%b!Z!i%b!Z!m%b!Z#O%b!Z#k%b!Z#l%b!Z#m%b!Z#n%b!Z#o%b!Z#p%b!Z#q%b!Z#r%b!Z#s%b!Z#u%b!Z#w%b!Z#y%b!Z#z%b!Z'u%b!Z([%b!Z(m%b!Z!h%b!Z!V%b!Z's%b!Z#]%b!Zs%b!Z![%b!Z%f%b!Z!d%b!Z~P#.aOo:xO!d#vO(m'mO~OP%b!ZR%b!Z[%b!Zo%b!Z!i%b!Z!m%b!Z#O%b!Z#k%b!Z#l%b!Z#m%b!Z#n%b!Z#o%b!Z#p%b!Z#q%b!Z#r%b!Z#s%b!Z#u%b!Z#w%b!Z#y%b!Z#z%b!Z#}%b!Z([%b!Z(m%b!Z!Y%b!Z!Z%b!Z~P&NlOs(aX~P1qO}%pO~P!(oO(P!lO~P!(oO!VfX!YfX#]fX~P&+QOP]XR]X[]Xo]X}]X!P]X!Y]X!YfX!i]X!m]X#O]X#P]X#]]X#]fX#hfX#k]X#l]X#m]X#n]X#o]X#p]X#q]X#r]X#s]X#u]X#w]X#y]X#z]X$P]X([]X(m]X(t]X(u]X~O!dfX!h]X!hfX(mfX~P'BxOP;POQ;POSfOd<zOe!iOmkOo;POpkOqkOwkOy;PO{;PO!PWO!TkO!UkO![XO!f;SO!iZO!l;PO!m;PO!n;PO!p;TO!r;WO!u!hO$V!kO(O)XO(QTO(TUO([VO(j[O(y<xO~O!Y;dO!Z$oa~Oh%VOm%WOo%XOp$tOq$tOw%YOy%ZO{;oO!P${O![$|O!f=PO!i$xO#g;uO$V%_O$r;qO$t;sO$w%`O(O(rO(QTO(TUO([$uO(t$}O(u%PO~O#t)`O~P'GnOo!bX(m!bX~P# ZO!Z]X!ZfX~P'BxO!VfX!V$xX!YfX!Y$xX#]fX~P!/gO#h;XO~O!d#vO#h;XO~O#];iO~O#s;]O~O#];xO!Y(rX!Z(rX~O#];iO!Y(pX!Z(pX~O#h;yO~Og;{O~P!0kO#h<RO~O#h<SO~O!d#vO#h<TO~O!d#vO#h;yO~O#}<UO~P#AbO#h<VO~O#h<WO~O#h<]O~O#h<^O~O#h<_O~O#h<`O~O#}<aO~P!0kO#}<bO~P!0kO#P#Q#R#T#U#X#f#g#r(y$r$t$w%Z%e%f%g%n%p%s%t%v%x~'yT#l!U'w(P#mp#k#no}'x$['x(O$^(`~",
  goto: "$4Q)XPPPPPP)YPP)]P)nP+O/PPPPP5xPP6`PP<V?mP@QP@QPPP@QPBRP@QP@QP@QPBVPB[PByPGrPPPGvPPPPGvJxPPPKOKzPGvPGvPPNYGvPPPGvPGvP!!aGvP!%v!&{!'UP!'x!'|!'x!+YPPPPPPP!+y!&{PP!,Z!-gP!0jGvGv!0o!3z!8b!8b!<`PPP!<hGvPPPPPPPPPPP!?vP!ATPPGv!BfPGvPGvGvGvGvGvPGv!CxP!GRP!JWP!J[!Jf!Jj!JjP!GOP!Jn!JnP!MsP!MwGvGv!M}##RBV@QP@QP@Q@QP#$_@Q@Q#&j@Q#)Z@Q#+`@Q@Q#,O#.]#.]#.b#.k#.]#.wP#.]P@Q#/a@Q#3S@Q@Q5xPPP#6{PPP#7f#7fP#7fP#7|#7fPP#8SP#7yP#7y#8g#7y#9R#9X5u)]#9[)]P#9c#9c#9cP)]P)]P)]P)]PP)]P#9i#9lP#9l)]P#9pP#9sP)]P)]P)]P)]P)]P)])]PP#9y#:P#:[#:b#:h#:n#:t#;S#;Y#;d#;j#;t#;z#<[#<b#=S#=f#=l#=r#>Q#>g#@V#@e#@l#BR#Ba#C|#D[#Db#Dh#Dn#Dx#EO#EU#E`#Er#ExPPPPPPPPPP#FOPPPPPPP#Fs#Iz#KZ#Kb#KjPPP$!sP$!|$%t$,^$,a$,d$-P$-S$-Z$-cP$-i$-lP$.Y$.^$/U$0d$0i$1PPP$1U$1[$1`P$1c$1g$1k$2a$2x$3a$3e$3h$3k$3q$3t$3x$3|R!|RoqOXst!Z#d%k&o&q&r&t,k,p1|2PY!vQ']-]1a5eQ%rvQ%zyQ&R|Q&g!VS'T!e-TQ'c!iS'i!r!yU*e$|*V*jQ+i%{Q+v&TQ,[&aQ-Z'[Q-e'dQ-m'jQ0R*lQ1k,]R;v;T%QdOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$_$a$e%k%r&P&h&k&o&q&r&t&x'Q'_'o(P(R(X(`(t(v(z)y+R+V,h,k,p-a-i-w-}.l.s/f0a0g0v1d1t1u1w1y1|2P2R2r2x3^5b5m5}6O6R6f8R8X8h8rS#q];Q!r)Z$Z$n'U)o,|-P.}2b3u5`6]9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<{U*y%[;n;oQ+n%}Q,^&dQ,e&lQ0m+aQ0q+cQ0|+oQ1s,cQ3Q._Q5O0wQ5t1lQ6r3UQ7s5PR8x6t'OkOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n%k%r&P&h&k&l&o&q&r&t&x'Q'U'_'o(P(R(X(`(t(v(z)o)y+R+V+a,h,k,p,|-P-a-i-w-}._.l.s.}/f0a0g0v1d1t1u1w1y1|2P2R2b2r2x3U3^3u5`5b5m5}6O6R6]6f6t8R8X8h8r9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<{t!nQ!r!v!y!z'T'[']'i'j'k-T-Z-]-m1a5e5g$|$ti#v$b$c$d$x${%O%Q%]%^%b)u){)}*P*R*U*[*b*r*s+`+c+z+}.^.w/]/e/o/p/r0V0X0d1W1Z1c3T3}4Y4b4m4u4x5l6p7_7h8U8u9T9b9l:O:c:k;g;h;j;k;l;m;p;q;r;s;t;u;|;}<O<P<R<S<V<W<X<Y<Z<[<]<^<a<b<x=Q=R=U=VQ&U|Q'R!eU'X%g*V-WQ+n%}Q,^&dQ0c*|Q0|+oQ1R+uQ1r,bQ1s,cQ5O0wQ5X1TQ5t1lQ5w1nQ5x1qQ7s5PQ7v5UQ8a5zQ9g7wR9r8^rnOXst!V!Z#d%k&f&o&q&r&t,k,p1|2PR,`&h&x^OPXYstuvwz!Z!`!g!j!o#S#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n%k%r&P&h&k&l&o&q&r&t&x'Q'_'o(R(X(`(t(v(z)o)y+R+V+a,h,k,p,|-P-a-i-w-}._.l.s.}/f0a0g0v1d1t1u1w1y1|2P2R2b2r2x3U3^3u5`5b5m5}6O6R6]6f6t8R8X8h8r9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<z<{[#]WZ#W#Z'U(P!b%hm#h#i#l$x%c%f(Y(d(e(f*U*Y*]+T+U+W,g,}-{.R.S.T.V/e/h2U2|2}4Q6[6mQ%uxQ%yyS&O|&TQ&[!TQ'`!hQ'b!iQ(m#sS+h%z%{Q+l%}Q,V&_Q,Z&aS-d'c'dQ.a(nQ0u+iQ0{+oQ0}+pQ1Q+tQ1f,WS1j,[,]Q2n-eQ4}0wQ5R0zQ5W1SQ5s1kQ7r5PQ7u5TQ9c7qR:^9d!O$zi$d%O%Q%]%^%b)}*P*[*r*s.w/o0V0X0d3}4m9T<x=Q=R!S%wy!i!u%y%z%{'S'b'c'd'h'r*d+h+i-Q-d-e-l/y0u2g2n2u4dQ+b%uQ+{&XQ,O&YQ,Y&aQ.`(mQ1e,VU1i,Z,[,]Q3V.aQ5n1fS5r1j1kQ8]5s#^<|#v$b$c$x${)u){*R*U*b+`+c+z+}.^/]/e/p/r1W1Z1c3T4Y4b4u4x5l6p7_7h8U8u9b9l:O:c:k;j;l;p;r;t;|<O<R<V<X<Z<]<a=U=Vo<};g;h;k;m;q;s;u;}<P<S<W<Y<[<^<bW%Ti%V*t<xS&X!Q&fQ&Y!RQ&Z!SR+y&V$}%Si#v$b$c$d$x${%O%Q%]%^%b)u){)}*P*R*U*[*b*r*s+`+c+z+}.^.w/]/e/o/p/r0V0X0d1W1Z1c3T3}4Y4b4m4u4x5l6p7_7h8U8u9T9b9l:O:c:k;g;h;j;k;l;m;p;q;r;s;t;u;|;}<O<P<R<S<V<W<X<Y<Z<[<]<^<a<b<x=Q=R=U=VT)v$u)wV*y%[;n;oW'X!e%g*V-WS(y#y#zQ+]%pQ+s&QS.Y(i(jQ1[,PQ4n0`R7{5^'OkOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n%k%r&P&h&k&l&o&q&r&t&x'Q'U'_'o(P(R(X(`(t(v(z)o)y+R+V+a,h,k,p,|-P-a-i-w-}._.l.s.}/f0a0g0v1d1t1u1w1y1|2P2R2b2r2x3U3^3u5`5b5m5}6O6R6]6f6t8R8X8h8r9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<{$i$^c#Y#e%o%q%s(O(U(p(u(})O)P)Q)R)S)T)U)V)W)Y)[)^)c)m+^+r-R-p-u-z-|.k.n.r.t.u.v/X0e2]2`2p2w3]3b3c3d3e3f3g3h3i3j3k3l3m3n3q3r3y4r4{6_6e6j6y6z7T7U7}8l8p8z9Q9R9{:`:g;R<oT#TV#U'PkOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n%k%r&P&h&k&l&o&q&r&t&x'Q'U'_'o(P(R(X(`(t(v(z)o)y+R+V+a,h,k,p,|-P-a-i-w-}._.l.s.}/f0a0g0v1d1t1u1w1y1|2P2R2b2r2x3U3^3u5`5b5m5}6O6R6]6f6t8R8X8h8r9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<{Q'V!eR2c-Tv!nQ!e!r!v!y!z'T'[']'i'j'k-T-Z-]-m1a5e5gU*d$|*V*jS/y*e*lQ0S*mQ1^,RQ4d0RR4g0UnqOXst!Z#d%k&o&q&r&t,k,p1|2PQ&v!^Q's!xS(o#u;XQ+f%xQ,T&[Q,U&^Q-b'aQ-o'lS.j(t;yS0f+R<TQ0s+gQ1`,SQ2T,rQ2V,sQ2_-OQ2l-cQ2o-gS4s0g<_Q4y0tS4|0v<`Q6^2aQ6b2mQ6g2tQ7p4zQ8m6`Q8n6cQ8q6hR9x8j$d$]c#Y#e%q%s(O(U(p(u(})O)P)Q)R)S)T)U)V)W)Y)[)^)c)m+^+r-R-p-u-z-|.k.n.r.u.v/X0e2]2`2p2w3]3b3c3d3e3f3g3h3i3j3k3l3m3n3q3r3y4r4{6_6e6j6y6z7T7U7}8l8p8z9Q9R9{:`:g;R<oS(k#p'fQ({#zS+[%o.tS.Z(j(lR3O.['OkOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n%k%r&P&h&k&l&o&q&r&t&x'Q'U'_'o(P(R(X(`(t(v(z)o)y+R+V+a,h,k,p,|-P-a-i-w-}._.l.s.}/f0a0g0v1d1t1u1w1y1|2P2R2b2r2x3U3^3u5`5b5m5}6O6R6]6f6t8R8X8h8r9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<{S#q];QQ&q!XQ&r!YQ&t![Q&u!]R1{,nQ'^!hQ+_%uQ-`'`S.](m+bQ2j-_W3S.`.a0l0nQ6a2kW6n3P3R3V4wU8t6o6q6sU9}8v8w8yS:i9|:PQ:t:jR:z:uU!wQ']-]T5c1a5e!Q_OXZ`st!V!Z#d#h%c%k&f&h&o&q&r&t(f,k,p.S1|2P]!pQ!r']-]1a5eT#q];Q%[{OPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$_$a$e%k%r&P&h&k&l&o&q&r&t&x'Q'_'o(P(R(X(`(t(v(z)y+R+V+a,h,k,p-a-i-w-}._.l.s/f0a0g0v1d1t1u1w1y1|2P2R2r2x3U3^5b5m5}6O6R6f6t8R8X8h8rS(y#y#zS.Y(i(j!s<f$Z$n'U)o,|-P.}2b3u5`6]9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<{U$fd)Z,eS(l#p'fU*q%R(s3pU0b*x.f7PQ4w0mQ6o3QQ8w6rR:P8xm!tQ!r!v!y!z']'i'j'k-]-m1a5e5gQ'q!uS(b#g1vS-k'h'tQ/k*XQ/w*dQ2v-nQ4U/lS4_/x0SQ7Z4PS7f4e4gQ9V7[Q9Z7cQ9`7iS:X9[9]S:n:Y:ZS:w:o:pR:}:xQ#wbQ'p!uS(a#g1vS(c#m+QQ+S%dQ+d%vQ+j%|U-j'h'q'tQ.O(bQ/j*XQ/v*dQ/|*gQ0r+eQ1g,XS2s-k-nQ2{.WS4T/k/lS4^/w0SQ4a/{Q4c/}Q5p1hQ6i2vQ7Y4PQ7^4US7b4_4gQ7g4fQ8Z5qS9U7Z7[Q9Y7cQ9^7fQ9a7jQ9o8[Q:V9VS:W9Z9]Q:[9`Q:e9pS:m:X:ZS:v:n:pQ:|:wQ;O:}Q<i<dQ<t<mR<u<nV!wQ']-]%[aOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$_$a$e%k%r&P&h&k&l&o&q&r&t&x'Q'_'o(P(R(X(`(t(v(z)y+R+V+a,h,k,p-a-i-w-}._.l.s/f0a0g0v1d1t1u1w1y1|2P2R2r2x3U3^5b5m5}6O6R6f6t8R8X8h8rS#wz!j!r<c$Z$n'U)o,|-P.}2b3u5`6]9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<{R<i<z%[bOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$_$a$e%k%r&P&h&k&l&o&q&r&t&x'Q'_'o(P(R(X(`(t(v(z)y+R+V+a,h,k,p-a-i-w-}._.l.s/f0a0g0v1d1t1u1w1y1|2P2R2r2x3U3^5b5m5}6O6R6f6t8R8X8h8rQ%dj!S%vy!i!u%y%z%{'S'b'c'd'h'r*d+h+i-Q-d-e-l/y0u2g2n2u4dS%|z!jQ+e%wQ,X&aW1h,Y,Z,[,]U5q1i1j1kS8[5r5sQ9p8]!r<d$Z$n'U)o,|-P.}2b3u5`6]9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<{Q<m<yR<n<z%OeOPXYstuvw!Z!`!g!o#S#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$_$a$e%k%r&P&h&k&o&q&r&t&x'Q'_'o(R(X(`(t(v(z)y+R+V+a,h,k,p-a-i-w-}._.l.s/f0a0g0v1d1t1u1w1y1|2P2R2r2x3U3^5b5m5}6O6R6f6t8R8X8h8rY#bWZ#W#Z(P!b%hm#h#i#l$x%c%f(Y(d(e(f*U*Y*]+T+U+W,g,}-{.R.S.T.V/e/h2U2|2}4Q6[6mQ,f&l!p<e$Z$n)o,|-P.}2b3u5`6]9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<{R<h'UU'Y!e%g*VR2e-W%QdOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$_$a$e%k%r&P&h&k&o&q&r&t&x'Q'_'o(P(R(X(`(t(v(z)y+R+V,h,k,p-a-i-w-}.l.s/f0a0g0v1d1t1u1w1y1|2P2R2r2x3^5b5m5}6O6R6f8R8X8h8r!r)Z$Z$n'U)o,|-P.}2b3u5`6]9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<{Q,e&lQ0m+aQ3Q._Q6r3UR8x6t!b$Tc#Y%o(O(U(p(u)V)W)[)c+r-p-u-z-|.k.n/X0e2p2w3]3m4r4{6e6j6y8p9{;R!P;_)Y)m-R.t2]2`3b3k3l3q3y6_6z7T7U7}8l8z9Q9R:`:g<o!f$Vc#Y%o(O(U(p(u)S)T)V)W)[)c+r-p-u-z-|.k.n/X0e2p2w3]3m4r4{6e6j6y8p9{;R!T;a)Y)m-R.t2]2`3b3h3i3k3l3q3y6_6z7T7U7}8l8z9Q9R:`:g<o!^$Zc#Y%o(O(U(p(u)[)c+r-p-u-z-|.k.n/X0e2p2w3]3m4r4{6e6j6y8p9{;RQ3}/cz<{)Y)m-R.t2]2`3b3q3y6_6z7T7U7}8l8z9Q9R:`:g<oQ=Q=SR=R=T'OkOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n%k%r&P&h&k&l&o&q&r&t&x'Q'U'_'o(P(R(X(`(t(v(z)o)y+R+V+a,h,k,p,|-P-a-i-w-}._.l.s.}/f0a0g0v1d1t1u1w1y1|2P2R2b2r2x3U3^3u5`5b5m5}6O6R6]6f6t8R8X8h8r9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<{S$oh$pR3v.|'VgOPWXYZhstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n$p%k%r&P&h&k&l&o&q&r&t&x'Q'U'_'o(P(R(X(`(t(v(z)o)y+R+V+a,h,k,p,|-P-a-i-w-}._.l.s.|.}/f0a0g0v1d1t1u1w1y1|2P2R2b2r2x3U3^3u5`5b5m5}6O6R6]6f6t8R8X8h8r9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<{T$kf$qQ$ifS)f$l)jR)r$qT$jf$qT)h$l)j'VhOPWXYZhstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n$p%k%r&P&h&k&l&o&q&r&t&x'Q'U'_'o(P(R(X(`(t(v(z)o)y+R+V+a,h,k,p,|-P-a-i-w-}._.l.s.|.}/f0a0g0v1d1t1u1w1y1|2P2R2b2r2x3U3^3u5`5b5m5}6O6R6]6f6t8R8X8h8r9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<{T$oh$pQ$rhR)q$p%[jOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$_$a$e%k%r&P&h&k&l&o&q&r&t&x'Q'_'o(P(R(X(`(t(v(z)y+R+V+a,h,k,p-a-i-w-}._.l.s/f0a0g0v1d1t1u1w1y1|2P2R2r2x3U3^5b5m5}6O6R6f6t8R8X8h8r!s<y$Z$n'U)o,|-P.}2b3u5`6]9h9y;P;S;T;W;X;Y;Z;[;];^;_;`;a;b;c;d;f;i;v;x;y;{<T<U<_<`<{#elOPXZst!Z!`!o#S#d#o#{$n%k&h&k&l&o&q&r&t&x'Q'_(z)o+V+a,h,k,p-a._.}/f0a1d1t1u1w1y1|2P2R3U3u5b5m5}6O6R6t8R8X8h!O%Ri$d%O%Q%]%^%b)}*P*[*r*s.w/o0V0X0d3}4m9T<x=Q=R#^(s#v$b$c$x${)u){*R*U*b+`+c+z+}.^/]/e/p/r1W1Z1c3T4Y4b4u4x5l6p7_7h8U8u9b9l:O:c:k;j;l;p;r;t;|<O<R<V<X<Z<]<a=U=VQ*}%`Q/Y)zo3p;g;h;k;m;q;s;u;}<P<S<W<Y<[<^<b!O$yi$d%O%Q%]%^%b)}*P*[*r*s.w/o0V0X0d3}4m9T<x=Q=RQ*^$zU*g$|*V*jQ+O%aQ/}*h#^<k#v$b$c$x${)u){*R*U*b+`+c+z+}.^/]/e/p/r1W1Z1c3T4Y4b4u4x5l6p7_7h8U8u9b9l:O:c:k;j;l;p;r;t;|<O<R<V<X<Z<]<a=U=Vn<l;g;h;k;m;q;s;u;}<P<S<W<Y<[<^<bQ<p<|Q<q<}Q<r=OR<s=P!O%Ri$d%O%Q%]%^%b)}*P*[*r*s.w/o0V0X0d3}4m9T<x=Q=R#^(s#v$b$c$x${)u){*R*U*b+`+c+z+}.^/]/e/p/r1W1Z1c3T4Y4b4u4x5l6p7_7h8U8u9b9l:O:c:k;j;l;p;r;t;|<O<R<V<X<Z<]<a=U=Vo3p;g;h;k;m;q;s;u;}<P<S<W<Y<[<^<bnoOXst!Z#d%k&o&q&r&t,k,p1|2PS*a${*UQ,y&{Q,z&}R4X/p$|%Si#v$b$c$d$x${%O%Q%]%^%b)u){)}*P*R*U*[*b*r*s+`+c+z+}.^.w/]/e/o/p/r0V0X0d1W1Z1c3T3}4Y4b4m4u4x5l6p7_7h8U8u9T9b9l:O:c:k;g;h;j;k;l;m;p;q;r;s;t;u;|;}<O<P<R<S<V<W<X<Y<Z<[<]<^<a<b<x=Q=R=U=VQ+|&YQ1Y,OQ5[1XR7z5]V*i$|*V*jU*i$|*V*jT5d1a5eU/{*f/f5bS4f0T8RR7j4hQ+d%vQ/|*gQ0r+eQ1g,XQ5p1hQ8Z5qQ9o8[R:e9p!O%Oi$d%O%Q%]%^%b)}*P*[*r*s.w/o0V0X0d3}4m9T<x=Q=Rr)}$v)a*O*p+P/n0Z0[3s4V4q7X7k:U<j<v<wS0V*o0W#^;j#v$b$c$x${)u){*R*U*b+`+c+z+}.^/]/e/p/r1W1Z1c3T4Y4b4u4x5l6p7_7h8U8u9b9l:O:c:k;j;l;p;r;t;|<O<R<V<X<Z<]<a=U=Vn;k;g;h;k;m;q;s;u;}<P<S<W<Y<[<^<b!`;|(q)_*W*`.b.e.i/U/Z/c/s0k1V1X3Y4W4[5Z5]6u6x7`7d7m7o9X9_:]:l=S=T`;}3o6{7O7S8{:Q:T:{S<X.d3ZT<Y6}9O!O%Qi$d%O%Q%]%^%b)}*P*[*r*s.w/o0V0X0d3}4m9T<x=Q=Rv*P$v)a*Q*o+P/_/n0Z0[3s4V4i4q7X7k:U<j<v<wS0X*p0Y#^;l#v$b$c$x${)u){*R*U*b+`+c+z+}.^/]/e/p/r1W1Z1c3T4Y4b4u4x5l6p7_7h8U8u9b9l:O:c:k;j;l;p;r;t;|<O<R<V<X<Z<]<a=U=Vn;m;g;h;k;m;q;s;u;}<P<S<W<Y<[<^<b!d<O(q)_*W*`.c.d.i/U/Z/c/s0k1V1X3W3Y4W4[5Z5]6u6v6x7`7d7m7o9X9_:]:l=S=Td<P3o6|6}7S8{8|:Q:R:T:{S<Z.e3[T<[7O9PrnOXst!V!Z#d%k&f&o&q&r&t,k,p1|2PQ&c!UR,h&lrnOXst!V!Z#d%k&f&o&q&r&t,k,p1|2PR&c!UQ,Q&ZR1U+ysnOXst!V!Z#d%k&f&o&q&r&t,k,p1|2PQ1b,VS5k1e1fU8T5i5j5nS9k8V8WS:a9j9mQ:q:bR:y:rQ&j!VR,a&fR5w1nS&O|&TR0}+pQ&o!WR,k&pR,q&uT1},p2PR,u&vQ,t&vR2W,uQ'v!{R-q'vSsOtQ#dXT%ns#dQ#OTR'x#OQ#RUR'z#RQ)w$uR/V)wQ#UVR'|#UQ#XWU(S#X(T-xQ(T#YR-x(UQ-U'VR2d-UQ.m(uS3_.m3`R3`.nQ-]']R2h-]Y!rQ']-]1a5eR'g!rQ.x)aR3t.xU#_W%f*UU(Z#_([-yQ([#`R-y(VQ-X'YR2f-Xt`OXst!V!Z#d%k&f&h&o&q&r&t,k,p1|2PS#hZ%cU#r`#h.SR.S(fQ(g#jQ.P(cW.X(g.P2y6kQ2y.QR6k2zQ)j$lR/O)jQ$phR)p$pQ$`cU)]$`-t;eQ-t;RR;e)mQ/i*XW4R/i4S7]9WU4S/j/k/lS7]4T4UR9W7^$Z)|$v(q)_)a*W*`*o*p*z*{+P.d.e.g.h.i/U/Z/_/a/c/n/s0Z0[0k1V1X3W3X3Y3o3s4V4W4[4i4k4q5Z5]6u6v6w6x6}7O7Q7R7S7X7`7d7k7m7o8{8|8}9X9_:Q:R:S:T:U:]:l:{<j<v<w=S=TQ/q*`U4Z/q4]7aQ4]/sR7a4[S*j$|*VR0P*jr*O$v)a*o*p+P/n0Z0[3s4V4q7X7k:U<j<v<w!`.b(q)_*W*`.d.e.i/U/Z/c/s0k1V1X3Y4W4[5Z5]6u6x7`7d7m7o9X9_:]:l=S=TU/`*O.b6{a6{3o6}7O7S8{:Q:T:{Q0W*oQ3Z.dU4j0W3Z9OR9O6}v*Q$v)a*o*p+P/_/n0Z0[3s4V4i4q7X7k:U<j<v<w!d.c(q)_*W*`.d.e.i/U/Z/c/s0k1V1X3W3Y4W4[5Z5]6u6v6x7`7d7m7o9X9_:]:l=S=TU/b*Q.c6|e6|3o6}7O7S8{8|:Q:R:T:{Q0Y*pQ3[.eU4l0Y3[9PR9P7OQ*u%UR0^*uQ4v0kR7n4vQ+X%iR0j+XQ5_1[S7|5_9iR9i7}Q,S&[R1_,SQ5e1aR8P5eQ1m,^S5u1m8_R8_5wQ0x+lW5Q0x5S7t9eQ5S0{Q7t5RR9e7uQ+q&OR1O+qQ2P,pR6V2PYrOXst#dQ&s!ZQ+Z%kQ,j&oQ,l&qQ,m&rQ,o&tQ1z,kS1},p2PR6U1|Q%mpQ&w!_Q&z!aQ&|!bQ'O!cQ'n!uQ+Y%jQ+f%xQ+x&UQ,`&jQ,w&yW-h'h'p'q'tQ-o'lQ0O*iQ0s+gS1p,a,dQ2X,vQ2Y,yQ2Z,zQ2o-gW2q-j-k-n-pQ4y0tQ5V1RQ5Y1VQ5o1gQ5y1rQ6T1{U6d2p2s2vQ6g2tQ7p4zQ7x5XQ7y5ZQ8O5dQ8Y5pQ8`5xS8o6e6iQ8q6hQ9f7vQ9n8ZQ9s8aQ9z8pQ:_9gQ:d9oQ:h9{R:s:eQ%xyQ'a!iQ'l!uU+g%y%z%{Q-O'SU-c'b'c'dS-g'h'rQ/u*dS0t+h+iQ2a-QS2m-d-eQ2t-lQ4`/yQ4z0uQ6`2gQ6c2nQ6h2uR7e4dS$wi<xR*v%VU%Ui%V<xR0]*tQ$viS(q#v+cS)_$b$cQ)a$dQ*W$xS*`${*UQ*o%OQ*p%QQ*z%]Q*{%^Q+P%bQ.d;jQ.e;lQ.g;pQ.h;rQ.i;tQ/U)uS/Z){/]Q/_)}Q/a*PQ/c*RQ/n*[S/s*b/eQ0Z*rQ0[*sh0k+`.^1c3T5l6p8U8u9l:O:c:kQ1V+zQ1X+}Q3W;|Q3X<OQ3Y<RS3o;g;hQ3s.wQ4V/oQ4W/pQ4[/rQ4i0VQ4k0XQ4q0dQ5Z1WQ5]1ZQ6u<VQ6v<XQ6w<ZQ6x<]Q6};kQ7O;mQ7Q;qQ7R;sQ7S;uQ7X3}Q7`4YQ7d4bQ7k4mQ7m4uQ7o4xQ8{<SQ8|;}Q8}<PQ9X7_Q9_7hQ:Q<WQ:R<YQ:S<[Q:T<^Q:U9TQ:]9bQ:l<aQ:{<bQ<j<xQ<v=QQ<w=RQ=S=UR=T=VQ*x%[Q.f;nR7P;onpOXst!Z#d%k&o&q&r&t,k,p1|2PQ!fPS#fZ#oQ&y!`U'e!o5b8RQ'{#SQ(|#{Q)n$nS,d&h&kQ,i&lQ,v&xQ,{'QQ-_'_Q.p(zQ/S)oS0h+V/fQ0n+aQ1x,hQ2k-aQ3R._Q3x.}Q4o0aQ5j1dQ5{1tQ5|1uQ6Q1wQ6S1yQ6X2RQ6s3UQ7V3uQ8W5mQ8d5}Q8e6OQ8g6RQ8y6tQ9m8XR9w8h#YcOPXZst!Z!`!o#d#o#{%k&h&k&l&o&q&r&t&x'Q'_(z+V+a,h,k,p-a._/f0a1d1t1u1w1y1|2P2R3U5b5m5}6O6R6t8R8X8hQ#YWQ#eYQ%ouQ%qvS%sw!gS(O#W(RQ(U#ZQ(p#uQ(u#xQ(}$OQ)O$PQ)P$QQ)Q$RQ)R$SQ)S$TQ)T$UQ)U$VQ)V$WQ)W$XQ)Y$ZQ)[$_Q)^$aQ)c$eW)m$n)o.}3uQ+^%rQ+r&PS-R'U2bQ-p'oS-u(P-wQ-z(XQ-|(`Q.k(tQ.n(vQ.r;PQ.t;SQ.u;TQ.v;WQ/X)yQ0e+RQ2],|Q2`-PQ2p-iQ2w-}Q3].lQ3b;XQ3c;YQ3d;ZQ3e;[Q3f;]Q3g;^Q3h;_Q3i;`Q3j;aQ3k;bQ3l;cQ3m.sQ3n;fQ3q;iQ3r;vQ3y;dQ4r0gQ4{0vQ6_;xQ6e2rQ6j2xQ6y3^Q6z;yQ7T;{Q7U<TQ7}5`Q8l6]Q8p6fQ8z<UQ9Q<_Q9R<`Q9{8rQ:`9hQ:g9yQ;R#SR<o<{R#[WR'W!el!tQ!r!v!y!z']'i'j'k-]-m1a5e5gS'S!e-TS-Q'T'[R2g-ZR(w#xQ!fQT-[']-]]!qQ!r']-]1a5eQ#p]R'f;QR)b$dY!uQ']-]1a5eQ'h!rS'r!v!yS't!z5gS-l'i'jQ-n'kR2u-mT#kZ%cS#jZ%cS%im,gU(c#h#i#lS.Q(d(eQ.U(fQ0i+WQ2z.RU2{.S.T.VS6l2|2}R8s6md#^W#W#Z%f(P(Y*U+T-{/er#gZm#h#i#l%c(d(e(f+W.R.S.T.V2|2}6mS*X$x*]Q/l*YQ1v,gQ2^,}Q4P/hQ6Z2UQ7[4QQ8k6[T<g'U+UV#aW%f*UU#`W%f*US(Q#W(YU(V#Z+T/eS-S'U+UT-v(P-{V'Z!e%g*VQ$lfR)t$qT)i$l)jR3w.|T*Z$x*]T*c${*UQ0l+`Q3P.^Q5i1cQ6q3TQ8V5lQ8v6pQ9j8UQ9|8uQ:b9lQ:j:OQ:r:cR:u:knqOXst!Z#d%k&o&q&r&t,k,p1|2PQ&i!VR,`&ftmOXst!U!V!Z#d%k&f&o&q&r&t,k,p1|2PR,g&lT%jm,gR1],PR,_&dQ&S|R+w&TR+m%}T&m!W&pT&n!W&pT2O,p2P",
  nodeNames: "⚠ ArithOp ArithOp ?. JSXStartTag LineComment BlockComment Script Hashbang ExportDeclaration export Star as VariableName String Escape from ; default FunctionDeclaration async function VariableDefinition > < TypeParamList TypeDefinition extends ThisType this LiteralType ArithOp Number BooleanLiteral TemplateType InterpolationEnd Interpolation InterpolationStart NullType null VoidType void TypeofType typeof MemberExpression . PropertyName [ TemplateString Escape Interpolation super RegExp ] ArrayExpression Spread , } { ObjectExpression Property async get set PropertyDefinition Block : NewTarget new NewExpression ) ( ArgList UnaryExpression delete LogicOp BitOp YieldExpression yield AwaitExpression await ParenthesizedExpression ClassExpression class ClassBody MethodDeclaration Decorator @ MemberExpression PrivatePropertyName CallExpression TypeArgList CompareOp < declare Privacy static abstract override PrivatePropertyDefinition PropertyDeclaration readonly accessor Optional TypeAnnotation Equals StaticBlock FunctionExpression ArrowFunction ParamList ParamList ArrayPattern ObjectPattern PatternProperty Privacy readonly Arrow MemberExpression BinaryExpression ArithOp ArithOp ArithOp ArithOp BitOp CompareOp instanceof satisfies in const CompareOp BitOp BitOp BitOp LogicOp LogicOp ConditionalExpression LogicOp LogicOp AssignmentExpression UpdateOp PostfixExpression CallExpression InstantiationExpression TaggedTemplateExpression DynamicImport import ImportMeta JSXElement JSXSelfCloseEndTag JSXSelfClosingTag JSXIdentifier JSXBuiltin JSXIdentifier JSXNamespacedName JSXMemberExpression JSXSpreadAttribute JSXAttribute JSXAttributeValue JSXEscape JSXEndTag JSXOpenTag JSXFragmentTag JSXText JSXEscape JSXStartCloseTag JSXCloseTag PrefixCast ArrowFunction TypeParamList SequenceExpression InstantiationExpression KeyofType keyof UniqueType unique ImportType InferredType infer TypeName ParenthesizedType FunctionSignature ParamList NewSignature IndexedType TupleType Label ArrayType ReadonlyType ObjectType MethodType PropertyType IndexSignature PropertyDefinition CallSignature TypePredicate is NewSignature new UnionType LogicOp IntersectionType LogicOp ConditionalType ParameterizedType ClassDeclaration abstract implements type VariableDeclaration let var using TypeAliasDeclaration InterfaceDeclaration interface EnumDeclaration enum EnumBody NamespaceDeclaration namespace module AmbientDeclaration declare GlobalDeclaration global ClassDeclaration ClassBody AmbientFunctionDeclaration ExportGroup VariableName VariableName ImportDeclaration ImportGroup ForStatement for ForSpec ForInSpec ForOfSpec of WhileStatement while WithStatement with DoStatement do IfStatement if else SwitchStatement switch SwitchBody CaseLabel case DefaultLabel TryStatement try CatchClause catch FinallyClause finally ReturnStatement return ThrowStatement throw BreakStatement break ContinueStatement continue DebuggerStatement debugger LabeledStatement ExpressionStatement SingleExpression SingleClassItem",
  maxTerm: 376,
  context: trackNewline,
  nodeProps: [
    ["isolate", -8,5,6,14,34,36,48,50,52,""],
    ["group", -26,9,17,19,65,204,208,212,213,215,218,221,231,233,239,241,243,245,248,254,260,262,264,266,268,270,271,"Statement",-34,13,14,29,32,33,39,48,51,52,54,59,67,69,73,77,79,81,82,107,108,117,118,135,138,140,141,142,143,144,146,147,166,167,169,"Expression",-23,28,30,34,38,40,42,171,173,175,176,178,179,180,182,183,184,186,187,188,198,200,202,203,"Type",-3,85,100,106,"ClassItem"],
    ["openedBy", 23,"<",35,"InterpolationStart",53,"[",57,"{",70,"(",159,"JSXStartCloseTag"],
    ["closedBy", 24,">",37,"InterpolationEnd",47,"]",58,"}",71,")",164,"JSXEndTag"]
  ],
  propSources: [jsHighlight],
  skippedNodes: [0,5,6,274],
  repeatNodeCount: 37,
  tokenData: "$Fq07[R!bOX%ZXY+gYZ-yZ[+g[]%Z]^.c^p%Zpq+gqr/mrs3cst:_tuEruvJSvwLkwx! Yxy!'iyz!(sz{!)}{|!,q|}!.O}!O!,q!O!P!/Y!P!Q!9j!Q!R#:O!R![#<_![!]#I_!]!^#Jk!^!_#Ku!_!`$![!`!a$$v!a!b$*T!b!c$,r!c!}Er!}#O$-|#O#P$/W#P#Q$4o#Q#R$5y#R#SEr#S#T$7W#T#o$8b#o#p$<r#p#q$=h#q#r$>x#r#s$@U#s$f%Z$f$g+g$g#BYEr#BY#BZ$A`#BZ$ISEr$IS$I_$A`$I_$I|Er$I|$I}$Dk$I}$JO$Dk$JO$JTEr$JT$JU$A`$JU$KVEr$KV$KW$A`$KW&FUEr&FU&FV$A`&FV;'SEr;'S;=`I|<%l?HTEr?HT?HU$A`?HUOEr(n%d_$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z&j&hT$h&jO!^&c!_#o&c#p;'S&c;'S;=`&w<%lO&c&j&zP;=`<%l&c'|'U]$h&j(U!bOY&}YZ&cZw&}wx&cx!^&}!^!_'}!_#O&}#O#P&c#P#o&}#o#p'}#p;'S&};'S;=`(l<%lO&}!b(SU(U!bOY'}Zw'}x#O'}#P;'S'};'S;=`(f<%lO'}!b(iP;=`<%l'}'|(oP;=`<%l&}'[(y]$h&j(RpOY(rYZ&cZr(rrs&cs!^(r!^!_)r!_#O(r#O#P&c#P#o(r#o#p)r#p;'S(r;'S;=`*a<%lO(rp)wU(RpOY)rZr)rs#O)r#P;'S)r;'S;=`*Z<%lO)rp*^P;=`<%l)r'[*dP;=`<%l(r#S*nX(Rp(U!bOY*gZr*grs'}sw*gwx)rx#O*g#P;'S*g;'S;=`+Z<%lO*g#S+^P;=`<%l*g(n+dP;=`<%l%Z07[+rq$h&j(Rp(U!b'w0/lOX%ZXY+gYZ&cZ[+g[p%Zpq+gqr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p$f%Z$f$g+g$g#BY%Z#BY#BZ+g#BZ$IS%Z$IS$I_+g$I_$JT%Z$JT$JU+g$JU$KV%Z$KV$KW+g$KW&FU%Z&FU&FV+g&FV;'S%Z;'S;=`+a<%l?HT%Z?HT?HU+g?HUO%Z07[.ST(S#S$h&j'x0/lO!^&c!_#o&c#p;'S&c;'S;=`&w<%lO&c07[.n_$h&j(Rp(U!b'x0/lOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z)3p/x`$h&j!m),Q(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`0z!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW1V`#u(Ch$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`2X!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW2d_#u(Ch$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'At3l_(Q':f$h&j(U!bOY4kYZ5qZr4krs7nsw4kwx5qx!^4k!^!_8p!_#O4k#O#P5q#P#o4k#o#p8p#p;'S4k;'S;=`:X<%lO4k(^4r_$h&j(U!bOY4kYZ5qZr4krs7nsw4kwx5qx!^4k!^!_8p!_#O4k#O#P5q#P#o4k#o#p8p#p;'S4k;'S;=`:X<%lO4k&z5vX$h&jOr5qrs6cs!^5q!^!_6y!_#o5q#o#p6y#p;'S5q;'S;=`7h<%lO5q&z6jT$c`$h&jO!^&c!_#o&c#p;'S&c;'S;=`&w<%lO&c`6|TOr6yrs7]s;'S6y;'S;=`7b<%lO6y`7bO$c``7eP;=`<%l6y&z7kP;=`<%l5q(^7w]$c`$h&j(U!bOY&}YZ&cZw&}wx&cx!^&}!^!_'}!_#O&}#O#P&c#P#o&}#o#p'}#p;'S&};'S;=`(l<%lO&}!r8uZ(U!bOY8pYZ6yZr8prs9hsw8pwx6yx#O8p#O#P6y#P;'S8p;'S;=`:R<%lO8p!r9oU$c`(U!bOY'}Zw'}x#O'}#P;'S'};'S;=`(f<%lO'}!r:UP;=`<%l8p(^:[P;=`<%l4k%9[:hh$h&j(Rp(U!bOY%ZYZ&cZq%Zqr<Srs&}st%ZtuCruw%Zwx(rx!^%Z!^!_*g!_!c%Z!c!}Cr!}#O%Z#O#P&c#P#R%Z#R#SCr#S#T%Z#T#oCr#o#p*g#p$g%Z$g;'SCr;'S;=`El<%lOCr(r<__WS$h&j(Rp(U!bOY<SYZ&cZr<Srs=^sw<Swx@nx!^<S!^!_Bm!_#O<S#O#P>`#P#o<S#o#pBm#p;'S<S;'S;=`Cl<%lO<S(Q=g]WS$h&j(U!bOY=^YZ&cZw=^wx>`x!^=^!^!_?q!_#O=^#O#P>`#P#o=^#o#p?q#p;'S=^;'S;=`@h<%lO=^&n>gXWS$h&jOY>`YZ&cZ!^>`!^!_?S!_#o>`#o#p?S#p;'S>`;'S;=`?k<%lO>`S?XSWSOY?SZ;'S?S;'S;=`?e<%lO?SS?hP;=`<%l?S&n?nP;=`<%l>`!f?xWWS(U!bOY?qZw?qwx?Sx#O?q#O#P?S#P;'S?q;'S;=`@b<%lO?q!f@eP;=`<%l?q(Q@kP;=`<%l=^'`@w]WS$h&j(RpOY@nYZ&cZr@nrs>`s!^@n!^!_Ap!_#O@n#O#P>`#P#o@n#o#pAp#p;'S@n;'S;=`Bg<%lO@ntAwWWS(RpOYApZrAprs?Ss#OAp#O#P?S#P;'SAp;'S;=`Ba<%lOAptBdP;=`<%lAp'`BjP;=`<%l@n#WBvYWS(Rp(U!bOYBmZrBmrs?qswBmwxApx#OBm#O#P?S#P;'SBm;'S;=`Cf<%lOBm#WCiP;=`<%lBm(rCoP;=`<%l<S%9[C}i$h&j(j%1l(Rp(U!bOY%ZYZ&cZr%Zrs&}st%ZtuCruw%Zwx(rx!Q%Z!Q![Cr![!^%Z!^!_*g!_!c%Z!c!}Cr!}#O%Z#O#P&c#P#R%Z#R#SCr#S#T%Z#T#oCr#o#p*g#p$g%Z$g;'SCr;'S;=`El<%lOCr%9[EoP;=`<%lCr07[FRk$h&j(Rp(U!b$[#t(O,2j(`$I[OY%ZYZ&cZr%Zrs&}st%ZtuEruw%Zwx(rx}%Z}!OGv!O!Q%Z!Q![Er![!^%Z!^!_*g!_!c%Z!c!}Er!}#O%Z#O#P&c#P#R%Z#R#SEr#S#T%Z#T#oEr#o#p*g#p$g%Z$g;'SEr;'S;=`I|<%lOEr+dHRk$h&j(Rp(U!b$[#tOY%ZYZ&cZr%Zrs&}st%ZtuGvuw%Zwx(rx}%Z}!OGv!O!Q%Z!Q![Gv![!^%Z!^!_*g!_!c%Z!c!}Gv!}#O%Z#O#P&c#P#R%Z#R#SGv#S#T%Z#T#oGv#o#p*g#p$g%Z$g;'SGv;'S;=`Iv<%lOGv+dIyP;=`<%lGv07[JPP;=`<%lEr(KWJ_`$h&j(Rp(U!b#m(ChOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KWKl_$h&j$P(Ch(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z,#xLva(u+JY$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sv%ZvwM{wx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KWNW`$h&j#y(Ch(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'At! c_(T';W$h&j(RpOY!!bYZ!#hZr!!brs!#hsw!!bwx!$xx!^!!b!^!_!%z!_#O!!b#O#P!#h#P#o!!b#o#p!%z#p;'S!!b;'S;=`!'c<%lO!!b'l!!i_$h&j(RpOY!!bYZ!#hZr!!brs!#hsw!!bwx!$xx!^!!b!^!_!%z!_#O!!b#O#P!#h#P#o!!b#o#p!%z#p;'S!!b;'S;=`!'c<%lO!!b&z!#mX$h&jOw!#hwx6cx!^!#h!^!_!$Y!_#o!#h#o#p!$Y#p;'S!#h;'S;=`!$r<%lO!#h`!$]TOw!$Ywx7]x;'S!$Y;'S;=`!$l<%lO!$Y`!$oP;=`<%l!$Y&z!$uP;=`<%l!#h'l!%R]$c`$h&j(RpOY(rYZ&cZr(rrs&cs!^(r!^!_)r!_#O(r#O#P&c#P#o(r#o#p)r#p;'S(r;'S;=`*a<%lO(r!Q!&PZ(RpOY!%zYZ!$YZr!%zrs!$Ysw!%zwx!&rx#O!%z#O#P!$Y#P;'S!%z;'S;=`!']<%lO!%z!Q!&yU$c`(RpOY)rZr)rs#O)r#P;'S)r;'S;=`*Z<%lO)r!Q!'`P;=`<%l!%z'l!'fP;=`<%l!!b/5|!'t_!i/.^$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z#&U!)O_!h!Lf$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z-!n!*[b$h&j(Rp(U!b(P%&f#n(ChOY%ZYZ&cZr%Zrs&}sw%Zwx(rxz%Zz{!+d{!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW!+o`$h&j(Rp(U!b#k(ChOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z+;x!,|`$h&j(Rp(U!bo+4YOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z,$U!.Z_!Y+Jf$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z07[!/ec$h&j(Rp(U!b}.2^OY%ZYZ&cZr%Zrs&}sw%Zwx(rx!O%Z!O!P!0p!P!Q%Z!Q![!3Y![!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z#%|!0ya$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!O%Z!O!P!2O!P!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z#%|!2Z_!X!L^$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad!3eg$h&j(Rp(U!bp'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q![!3Y![!^%Z!^!_*g!_!g%Z!g!h!4|!h#O%Z#O#P&c#P#R%Z#R#S!3Y#S#X%Z#X#Y!4|#Y#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad!5Vg$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx{%Z{|!6n|}%Z}!O!6n!O!Q%Z!Q![!8S![!^%Z!^!_*g!_#O%Z#O#P&c#P#R%Z#R#S!8S#S#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad!6wc$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q![!8S![!^%Z!^!_*g!_#O%Z#O#P&c#P#R%Z#R#S!8S#S#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad!8_c$h&j(Rp(U!bp'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q![!8S![!^%Z!^!_*g!_#O%Z#O#P&c#P#R%Z#R#S!8S#S#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z07[!9uf$h&j(Rp(U!b#l(ChOY!;ZYZ&cZr!;Zrs!<nsw!;Zwx!Lcxz!;Zz{#-}{!P!;Z!P!Q#/d!Q!^!;Z!^!_#(i!_!`#7S!`!a#8i!a!}!;Z!}#O#,f#O#P!Dy#P#o!;Z#o#p#(i#p;'S!;Z;'S;=`#-w<%lO!;Z?O!;fb$h&j(Rp(U!b!U7`OY!;ZYZ&cZr!;Zrs!<nsw!;Zwx!Lcx!P!;Z!P!Q#&`!Q!^!;Z!^!_#(i!_!}!;Z!}#O#,f#O#P!Dy#P#o!;Z#o#p#(i#p;'S!;Z;'S;=`#-w<%lO!;Z>^!<w`$h&j(U!b!U7`OY!<nYZ&cZw!<nwx!=yx!P!<n!P!Q!Eq!Q!^!<n!^!_!Gr!_!}!<n!}#O!KS#O#P!Dy#P#o!<n#o#p!Gr#p;'S!<n;'S;=`!L]<%lO!<n<z!>Q^$h&j!U7`OY!=yYZ&cZ!P!=y!P!Q!>|!Q!^!=y!^!_!@c!_!}!=y!}#O!CW#O#P!Dy#P#o!=y#o#p!@c#p;'S!=y;'S;=`!Ek<%lO!=y<z!?Td$h&j!U7`O!^&c!_#W&c#W#X!>|#X#Z&c#Z#[!>|#[#]&c#]#^!>|#^#a&c#a#b!>|#b#g&c#g#h!>|#h#i&c#i#j!>|#j#k!>|#k#m&c#m#n!>|#n#o&c#p;'S&c;'S;=`&w<%lO&c7`!@hX!U7`OY!@cZ!P!@c!P!Q!AT!Q!}!@c!}#O!Ar#O#P!Bq#P;'S!@c;'S;=`!CQ<%lO!@c7`!AYW!U7`#W#X!AT#Z#[!AT#]#^!AT#a#b!AT#g#h!AT#i#j!AT#j#k!AT#m#n!AT7`!AuVOY!ArZ#O!Ar#O#P!B[#P#Q!@c#Q;'S!Ar;'S;=`!Bk<%lO!Ar7`!B_SOY!ArZ;'S!Ar;'S;=`!Bk<%lO!Ar7`!BnP;=`<%l!Ar7`!BtSOY!@cZ;'S!@c;'S;=`!CQ<%lO!@c7`!CTP;=`<%l!@c<z!C][$h&jOY!CWYZ&cZ!^!CW!^!_!Ar!_#O!CW#O#P!DR#P#Q!=y#Q#o!CW#o#p!Ar#p;'S!CW;'S;=`!Ds<%lO!CW<z!DWX$h&jOY!CWYZ&cZ!^!CW!^!_!Ar!_#o!CW#o#p!Ar#p;'S!CW;'S;=`!Ds<%lO!CW<z!DvP;=`<%l!CW<z!EOX$h&jOY!=yYZ&cZ!^!=y!^!_!@c!_#o!=y#o#p!@c#p;'S!=y;'S;=`!Ek<%lO!=y<z!EnP;=`<%l!=y>^!Ezl$h&j(U!b!U7`OY&}YZ&cZw&}wx&cx!^&}!^!_'}!_#O&}#O#P&c#P#W&}#W#X!Eq#X#Z&}#Z#[!Eq#[#]&}#]#^!Eq#^#a&}#a#b!Eq#b#g&}#g#h!Eq#h#i&}#i#j!Eq#j#k!Eq#k#m&}#m#n!Eq#n#o&}#o#p'}#p;'S&};'S;=`(l<%lO&}8r!GyZ(U!b!U7`OY!GrZw!Grwx!@cx!P!Gr!P!Q!Hl!Q!}!Gr!}#O!JU#O#P!Bq#P;'S!Gr;'S;=`!J|<%lO!Gr8r!Hse(U!b!U7`OY'}Zw'}x#O'}#P#W'}#W#X!Hl#X#Z'}#Z#[!Hl#[#]'}#]#^!Hl#^#a'}#a#b!Hl#b#g'}#g#h!Hl#h#i'}#i#j!Hl#j#k!Hl#k#m'}#m#n!Hl#n;'S'};'S;=`(f<%lO'}8r!JZX(U!bOY!JUZw!JUwx!Arx#O!JU#O#P!B[#P#Q!Gr#Q;'S!JU;'S;=`!Jv<%lO!JU8r!JyP;=`<%l!JU8r!KPP;=`<%l!Gr>^!KZ^$h&j(U!bOY!KSYZ&cZw!KSwx!CWx!^!KS!^!_!JU!_#O!KS#O#P!DR#P#Q!<n#Q#o!KS#o#p!JU#p;'S!KS;'S;=`!LV<%lO!KS>^!LYP;=`<%l!KS>^!L`P;=`<%l!<n=l!Ll`$h&j(Rp!U7`OY!LcYZ&cZr!Lcrs!=ys!P!Lc!P!Q!Mn!Q!^!Lc!^!_# o!_!}!Lc!}#O#%P#O#P!Dy#P#o!Lc#o#p# o#p;'S!Lc;'S;=`#&Y<%lO!Lc=l!Mwl$h&j(Rp!U7`OY(rYZ&cZr(rrs&cs!^(r!^!_)r!_#O(r#O#P&c#P#W(r#W#X!Mn#X#Z(r#Z#[!Mn#[#](r#]#^!Mn#^#a(r#a#b!Mn#b#g(r#g#h!Mn#h#i(r#i#j!Mn#j#k!Mn#k#m(r#m#n!Mn#n#o(r#o#p)r#p;'S(r;'S;=`*a<%lO(r8Q# vZ(Rp!U7`OY# oZr# ors!@cs!P# o!P!Q#!i!Q!}# o!}#O#$R#O#P!Bq#P;'S# o;'S;=`#$y<%lO# o8Q#!pe(Rp!U7`OY)rZr)rs#O)r#P#W)r#W#X#!i#X#Z)r#Z#[#!i#[#])r#]#^#!i#^#a)r#a#b#!i#b#g)r#g#h#!i#h#i)r#i#j#!i#j#k#!i#k#m)r#m#n#!i#n;'S)r;'S;=`*Z<%lO)r8Q#$WX(RpOY#$RZr#$Rrs!Ars#O#$R#O#P!B[#P#Q# o#Q;'S#$R;'S;=`#$s<%lO#$R8Q#$vP;=`<%l#$R8Q#$|P;=`<%l# o=l#%W^$h&j(RpOY#%PYZ&cZr#%Prs!CWs!^#%P!^!_#$R!_#O#%P#O#P!DR#P#Q!Lc#Q#o#%P#o#p#$R#p;'S#%P;'S;=`#&S<%lO#%P=l#&VP;=`<%l#%P=l#&]P;=`<%l!Lc?O#&kn$h&j(Rp(U!b!U7`OY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#W%Z#W#X#&`#X#Z%Z#Z#[#&`#[#]%Z#]#^#&`#^#a%Z#a#b#&`#b#g%Z#g#h#&`#h#i%Z#i#j#&`#j#k#&`#k#m%Z#m#n#&`#n#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z9d#(r](Rp(U!b!U7`OY#(iZr#(irs!Grsw#(iwx# ox!P#(i!P!Q#)k!Q!}#(i!}#O#+`#O#P!Bq#P;'S#(i;'S;=`#,`<%lO#(i9d#)th(Rp(U!b!U7`OY*gZr*grs'}sw*gwx)rx#O*g#P#W*g#W#X#)k#X#Z*g#Z#[#)k#[#]*g#]#^#)k#^#a*g#a#b#)k#b#g*g#g#h#)k#h#i*g#i#j#)k#j#k#)k#k#m*g#m#n#)k#n;'S*g;'S;=`+Z<%lO*g9d#+gZ(Rp(U!bOY#+`Zr#+`rs!JUsw#+`wx#$Rx#O#+`#O#P!B[#P#Q#(i#Q;'S#+`;'S;=`#,Y<%lO#+`9d#,]P;=`<%l#+`9d#,cP;=`<%l#(i?O#,o`$h&j(Rp(U!bOY#,fYZ&cZr#,frs!KSsw#,fwx#%Px!^#,f!^!_#+`!_#O#,f#O#P!DR#P#Q!;Z#Q#o#,f#o#p#+`#p;'S#,f;'S;=`#-q<%lO#,f?O#-tP;=`<%l#,f?O#-zP;=`<%l!;Z07[#.[b$h&j(Rp(U!b'y0/l!U7`OY!;ZYZ&cZr!;Zrs!<nsw!;Zwx!Lcx!P!;Z!P!Q#&`!Q!^!;Z!^!_#(i!_!}!;Z!}#O#,f#O#P!Dy#P#o!;Z#o#p#(i#p;'S!;Z;'S;=`#-w<%lO!;Z07[#/o_$h&j(Rp(U!bT0/lOY#/dYZ&cZr#/drs#0nsw#/dwx#4Ox!^#/d!^!_#5}!_#O#/d#O#P#1p#P#o#/d#o#p#5}#p;'S#/d;'S;=`#6|<%lO#/d06j#0w]$h&j(U!bT0/lOY#0nYZ&cZw#0nwx#1px!^#0n!^!_#3R!_#O#0n#O#P#1p#P#o#0n#o#p#3R#p;'S#0n;'S;=`#3x<%lO#0n05W#1wX$h&jT0/lOY#1pYZ&cZ!^#1p!^!_#2d!_#o#1p#o#p#2d#p;'S#1p;'S;=`#2{<%lO#1p0/l#2iST0/lOY#2dZ;'S#2d;'S;=`#2u<%lO#2d0/l#2xP;=`<%l#2d05W#3OP;=`<%l#1p01O#3YW(U!bT0/lOY#3RZw#3Rwx#2dx#O#3R#O#P#2d#P;'S#3R;'S;=`#3r<%lO#3R01O#3uP;=`<%l#3R06j#3{P;=`<%l#0n05x#4X]$h&j(RpT0/lOY#4OYZ&cZr#4Ors#1ps!^#4O!^!_#5Q!_#O#4O#O#P#1p#P#o#4O#o#p#5Q#p;'S#4O;'S;=`#5w<%lO#4O00^#5XW(RpT0/lOY#5QZr#5Qrs#2ds#O#5Q#O#P#2d#P;'S#5Q;'S;=`#5q<%lO#5Q00^#5tP;=`<%l#5Q05x#5zP;=`<%l#4O01p#6WY(Rp(U!bT0/lOY#5}Zr#5}rs#3Rsw#5}wx#5Qx#O#5}#O#P#2d#P;'S#5};'S;=`#6v<%lO#5}01p#6yP;=`<%l#5}07[#7PP;=`<%l#/d)3h#7ab$h&j$P(Ch(Rp(U!b!U7`OY!;ZYZ&cZr!;Zrs!<nsw!;Zwx!Lcx!P!;Z!P!Q#&`!Q!^!;Z!^!_#(i!_!}!;Z!}#O#,f#O#P!Dy#P#o!;Z#o#p#(i#p;'S!;Z;'S;=`#-w<%lO!;ZAt#8vb$Y#t$h&j(Rp(U!b!U7`OY!;ZYZ&cZr!;Zrs!<nsw!;Zwx!Lcx!P!;Z!P!Q#&`!Q!^!;Z!^!_#(i!_!}!;Z!}#O#,f#O#P!Dy#P#o!;Z#o#p#(i#p;'S!;Z;'S;=`#-w<%lO!;Z'Ad#:Zp$h&j(Rp(U!bp'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!O%Z!O!P!3Y!P!Q%Z!Q![#<_![!^%Z!^!_*g!_!g%Z!g!h!4|!h#O%Z#O#P&c#P#R%Z#R#S#<_#S#U%Z#U#V#?i#V#X%Z#X#Y!4|#Y#b%Z#b#c#>_#c#d#Bq#d#l%Z#l#m#Es#m#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#<jk$h&j(Rp(U!bp'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!O%Z!O!P!3Y!P!Q%Z!Q![#<_![!^%Z!^!_*g!_!g%Z!g!h!4|!h#O%Z#O#P&c#P#R%Z#R#S#<_#S#X%Z#X#Y!4|#Y#b%Z#b#c#>_#c#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#>j_$h&j(Rp(U!bp'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#?rd$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q!R#AQ!R!S#AQ!S!^%Z!^!_*g!_#O%Z#O#P&c#P#R%Z#R#S#AQ#S#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#A]f$h&j(Rp(U!bp'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q!R#AQ!R!S#AQ!S!^%Z!^!_*g!_#O%Z#O#P&c#P#R%Z#R#S#AQ#S#b%Z#b#c#>_#c#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#Bzc$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q!Y#DV!Y!^%Z!^!_*g!_#O%Z#O#P&c#P#R%Z#R#S#DV#S#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#Dbe$h&j(Rp(U!bp'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q!Y#DV!Y!^%Z!^!_*g!_#O%Z#O#P&c#P#R%Z#R#S#DV#S#b%Z#b#c#>_#c#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#E|g$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q![#Ge![!^%Z!^!_*g!_!c%Z!c!i#Ge!i#O%Z#O#P&c#P#R%Z#R#S#Ge#S#T%Z#T#Z#Ge#Z#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#Gpi$h&j(Rp(U!bp'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q![#Ge![!^%Z!^!_*g!_!c%Z!c!i#Ge!i#O%Z#O#P&c#P#R%Z#R#S#Ge#S#T%Z#T#Z#Ge#Z#b%Z#b#c#>_#c#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z*)x#Il_!d$b$h&j#})Lv(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z)[#Jv_al$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z04f#LS^h#)`#O-<U(Rp(U!b(y7`OY*gZr*grs'}sw*gwx)rx!P*g!P!Q#MO!Q!^*g!^!_#Mt!_!`$ f!`#O*g#P;'S*g;'S;=`+Z<%lO*g(n#MXX$j&j(Rp(U!bOY*gZr*grs'}sw*gwx)rx#O*g#P;'S*g;'S;=`+Z<%lO*g(El#M}Z#o(Ch(Rp(U!bOY*gZr*grs'}sw*gwx)rx!_*g!_!`#Np!`#O*g#P;'S*g;'S;=`+Z<%lO*g(El#NyX$P(Ch(Rp(U!bOY*gZr*grs'}sw*gwx)rx#O*g#P;'S*g;'S;=`+Z<%lO*g(El$ oX#p(Ch(Rp(U!bOY*gZr*grs'}sw*gwx)rx#O*g#P;'S*g;'S;=`+Z<%lO*g*)x$!ga#]*!Y$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`0z!`!a$#l!a#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(K[$#w_#h(Cl$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z*)x$%Vag!*r#p(Ch$e#|$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`$&[!`!a$'f!a#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW$&g_#p(Ch$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW$'qa#o(Ch$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`!a$(v!a#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW$)R`#o(Ch$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(Kd$*`a(m(Ct$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!a%Z!a!b$+e!b#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW$+p`$h&j#z(Ch(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z%#`$,}_!y$Ip$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z04f$.X_!P0,v$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(n$/]Z$h&jO!^$0O!^!_$0f!_#i$0O#i#j$0k#j#l$0O#l#m$2^#m#o$0O#o#p$0f#p;'S$0O;'S;=`$4i<%lO$0O(n$0VT_#S$h&jO!^&c!_#o&c#p;'S&c;'S;=`&w<%lO&c#S$0kO_#S(n$0p[$h&jO!Q&c!Q![$1f![!^&c!_!c&c!c!i$1f!i#T&c#T#Z$1f#Z#o&c#o#p$3|#p;'S&c;'S;=`&w<%lO&c(n$1kZ$h&jO!Q&c!Q![$2^![!^&c!_!c&c!c!i$2^!i#T&c#T#Z$2^#Z#o&c#p;'S&c;'S;=`&w<%lO&c(n$2cZ$h&jO!Q&c!Q![$3U![!^&c!_!c&c!c!i$3U!i#T&c#T#Z$3U#Z#o&c#p;'S&c;'S;=`&w<%lO&c(n$3ZZ$h&jO!Q&c!Q![$0O![!^&c!_!c&c!c!i$0O!i#T&c#T#Z$0O#Z#o&c#p;'S&c;'S;=`&w<%lO&c#S$4PR!Q![$4Y!c!i$4Y#T#Z$4Y#S$4]S!Q![$4Y!c!i$4Y#T#Z$4Y#q#r$0f(n$4lP;=`<%l$0O#1[$4z_!V#)l$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW$6U`#w(Ch$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z+;p$7c_$h&j(Rp(U!b([+4QOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z07[$8qk$h&j(Rp(U!b(O,2j$^#t(`$I[OY%ZYZ&cZr%Zrs&}st%Ztu$8buw%Zwx(rx}%Z}!O$:f!O!Q%Z!Q![$8b![!^%Z!^!_*g!_!c%Z!c!}$8b!}#O%Z#O#P&c#P#R%Z#R#S$8b#S#T%Z#T#o$8b#o#p*g#p$g%Z$g;'S$8b;'S;=`$<l<%lO$8b+d$:qk$h&j(Rp(U!b$^#tOY%ZYZ&cZr%Zrs&}st%Ztu$:fuw%Zwx(rx}%Z}!O$:f!O!Q%Z!Q![$:f![!^%Z!^!_*g!_!c%Z!c!}$:f!}#O%Z#O#P&c#P#R%Z#R#S$:f#S#T%Z#T#o$:f#o#p*g#p$g%Z$g;'S$:f;'S;=`$<f<%lO$:f+d$<iP;=`<%l$:f07[$<oP;=`<%l$8b#Jf$<{X![#Hb(Rp(U!bOY*gZr*grs'}sw*gwx)rx#O*g#P;'S*g;'S;=`+Z<%lO*g,#x$=sa(t+JY$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p#q$+e#q;'S%Z;'S;=`+a<%lO%Z(Kd$?V_!Z(Cds`$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z?O$@a_!n7`$h&j(Rp(U!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z07[$Aq|$h&j(Rp(U!b'w0/l$[#t(O,2j(`$I[OX%ZXY+gYZ&cZ[+g[p%Zpq+gqr%Zrs&}st%ZtuEruw%Zwx(rx}%Z}!OGv!O!Q%Z!Q![Er![!^%Z!^!_*g!_!c%Z!c!}Er!}#O%Z#O#P&c#P#R%Z#R#SEr#S#T%Z#T#oEr#o#p*g#p$f%Z$f$g+g$g#BYEr#BY#BZ$A`#BZ$ISEr$IS$I_$A`$I_$JTEr$JT$JU$A`$JU$KVEr$KV$KW$A`$KW&FUEr&FU&FV$A`&FV;'SEr;'S;=`I|<%l?HTEr?HT?HU$A`?HUOEr07[$D|k$h&j(Rp(U!b'x0/l$[#t(O,2j(`$I[OY%ZYZ&cZr%Zrs&}st%ZtuEruw%Zwx(rx}%Z}!OGv!O!Q%Z!Q![Er![!^%Z!^!_*g!_!c%Z!c!}Er!}#O%Z#O#P&c#P#R%Z#R#SEr#S#T%Z#T#oEr#o#p*g#p$g%Z$g;'SEr;'S;=`I|<%lOEr",
  tokenizers: [noSemicolon, operatorToken, jsx, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, insertSemicolon, new LocalTokenGroup("$S~RRtu[#O#Pg#S#T#|~_P#o#pb~gOu~~jVO#i!P#i#j!U#j#l!P#l#m!q#m;'S!P;'S;=`#v<%lO!P~!UO!R~~!XS!Q![!e!c!i!e#T#Z!e#o#p#Z~!hR!Q![!q!c!i!q#T#Z!q~!tR!Q![!}!c!i!}#T#Z!}~#QR!Q![!P!c!i!P#T#Z!P~#^R!Q![#g!c!i#g#T#Z#g~#jS!Q![#g!c!i#g#T#Z#g#q#r!P~#yP;=`<%l!P~$RO(^~~", 141, 335), new LocalTokenGroup("j~RQYZXz{^~^O'{~~aP!P!Qd~iO'|~~", 25, 318)],
  topRules: {"Script":[0,7],"SingleExpression":[1,272],"SingleClassItem":[2,273]},
  dialects: {jsx: 0, ts: 14725},
  dynamicPrecedences: {"77":1,"79":1,"91":1,"167":1,"196":1},
  specialized: [{term: 322, get: (value) => spec_identifier[value] || -1},{term: 338, get: (value) => spec_word[value] || -1},{term: 92, get: (value) => spec_LessThan[value] || -1}],
  tokenPrec: 14749
});

function toSet(chars) {
    let flat = Object.keys(chars).join("");
    let words = /\w/.test(flat);
    if (words)
        flat = flat.replace(/\w/g, "");
    return `[${words ? "\\w" : ""}${flat.replace(/[^\w\s]/g, "\\$&")}]`;
}
function prefixMatch(options) {
    let first = Object.create(null), rest = Object.create(null);
    for (let { label } of options) {
        first[label[0]] = true;
        for (let i = 1; i < label.length; i++)
            rest[label[i]] = true;
    }
    let source = toSet(first) + toSet(rest) + "*$";
    return [new RegExp("^" + source), new RegExp(source)];
}
/**
Given a a fixed array of options, return an autocompleter that
completes them.
*/
function completeFromList(list) {
    let options = list.map(o => typeof o == "string" ? { label: o } : o);
    let [validFor, match] = options.every(o => /^\w+$/.test(o.label)) ? [/\w*$/, /\w+$/] : prefixMatch(options);
    return (context) => {
        let token = context.matchBefore(match);
        return token || context.explicit ? { from: token ? token.from : context.pos, options, validFor } : null;
    };
}
/**
Wrap the given completion source so that it will not fire when the
cursor is in a syntax node with one of the given names.
*/
function ifNotIn(nodes, source) {
    return (context) => {
        for (let pos = syntaxTree(context.state).resolveInner(context.pos, -1); pos; pos = pos.parent) {
            if (nodes.indexOf(pos.name) > -1)
                return null;
            if (pos.type.isTop)
                break;
        }
        return source(context);
    };
}
/**
This annotation is added to transactions that are produced by
picking a completion.
*/
const pickedCompletion = /*@__PURE__*/Annotation.define();

const baseTheme = /*@__PURE__*/EditorView.baseTheme({
    ".cm-tooltip.cm-tooltip-autocomplete": {
        "& > ul": {
            fontFamily: "monospace",
            whiteSpace: "nowrap",
            overflow: "hidden auto",
            maxWidth_fallback: "700px",
            maxWidth: "min(700px, 95vw)",
            minWidth: "250px",
            maxHeight: "10em",
            height: "100%",
            listStyle: "none",
            margin: 0,
            padding: 0,
            "& > li, & > completion-section": {
                padding: "1px 3px",
                lineHeight: 1.2
            },
            "& > li": {
                overflowX: "hidden",
                textOverflow: "ellipsis",
                cursor: "pointer"
            },
            "& > completion-section": {
                display: "list-item",
                borderBottom: "1px solid silver",
                paddingLeft: "0.5em",
                opacity: 0.7
            }
        }
    },
    "&light .cm-tooltip-autocomplete ul li[aria-selected]": {
        background: "#17c",
        color: "white",
    },
    "&light .cm-tooltip-autocomplete-disabled ul li[aria-selected]": {
        background: "#777",
    },
    "&dark .cm-tooltip-autocomplete ul li[aria-selected]": {
        background: "#347",
        color: "white",
    },
    "&dark .cm-tooltip-autocomplete-disabled ul li[aria-selected]": {
        background: "#444",
    },
    ".cm-completionListIncompleteTop:before, .cm-completionListIncompleteBottom:after": {
        content: '"···"',
        opacity: 0.5,
        display: "block",
        textAlign: "center"
    },
    ".cm-tooltip.cm-completionInfo": {
        position: "absolute",
        padding: "3px 9px",
        width: "max-content",
        maxWidth: `${400 /* Info.Width */}px`,
        boxSizing: "border-box"
    },
    ".cm-completionInfo.cm-completionInfo-left": { right: "100%" },
    ".cm-completionInfo.cm-completionInfo-right": { left: "100%" },
    ".cm-completionInfo.cm-completionInfo-left-narrow": { right: `${30 /* Info.Margin */}px` },
    ".cm-completionInfo.cm-completionInfo-right-narrow": { left: `${30 /* Info.Margin */}px` },
    "&light .cm-snippetField": { backgroundColor: "#00000022" },
    "&dark .cm-snippetField": { backgroundColor: "#ffffff22" },
    ".cm-snippetFieldPosition": {
        verticalAlign: "text-top",
        width: 0,
        height: "1.15em",
        display: "inline-block",
        margin: "0 -0.7px -.7em",
        borderLeft: "1.4px dotted #888"
    },
    ".cm-completionMatchedText": {
        textDecoration: "underline"
    },
    ".cm-completionDetail": {
        marginLeft: "0.5em",
        fontStyle: "italic"
    },
    ".cm-completionIcon": {
        fontSize: "90%",
        width: ".8em",
        display: "inline-block",
        textAlign: "center",
        paddingRight: ".6em",
        opacity: "0.6",
        boxSizing: "content-box"
    },
    ".cm-completionIcon-function, .cm-completionIcon-method": {
        "&:after": { content: "'ƒ'" }
    },
    ".cm-completionIcon-class": {
        "&:after": { content: "'○'" }
    },
    ".cm-completionIcon-interface": {
        "&:after": { content: "'◌'" }
    },
    ".cm-completionIcon-variable": {
        "&:after": { content: "'𝑥'" }
    },
    ".cm-completionIcon-constant": {
        "&:after": { content: "'𝐶'" }
    },
    ".cm-completionIcon-type": {
        "&:after": { content: "'𝑡'" }
    },
    ".cm-completionIcon-enum": {
        "&:after": { content: "'∪'" }
    },
    ".cm-completionIcon-property": {
        "&:after": { content: "'□'" }
    },
    ".cm-completionIcon-keyword": {
        "&:after": { content: "'🔑\uFE0E'" } // Disable emoji rendering
    },
    ".cm-completionIcon-namespace": {
        "&:after": { content: "'▢'" }
    },
    ".cm-completionIcon-text": {
        "&:after": { content: "'abc'", fontSize: "50%", verticalAlign: "middle" }
    }
});

class FieldPos {
    constructor(field, line, from, to) {
        this.field = field;
        this.line = line;
        this.from = from;
        this.to = to;
    }
}
class FieldRange {
    constructor(field, from, to) {
        this.field = field;
        this.from = from;
        this.to = to;
    }
    map(changes) {
        let from = changes.mapPos(this.from, -1, MapMode.TrackDel);
        let to = changes.mapPos(this.to, 1, MapMode.TrackDel);
        return from == null || to == null ? null : new FieldRange(this.field, from, to);
    }
}
class Snippet {
    constructor(lines, fieldPositions) {
        this.lines = lines;
        this.fieldPositions = fieldPositions;
    }
    instantiate(state, pos) {
        let text = [], lineStart = [pos];
        let lineObj = state.doc.lineAt(pos), baseIndent = /^\s*/.exec(lineObj.text)[0];
        for (let line of this.lines) {
            if (text.length) {
                let indent = baseIndent, tabs = /^\t*/.exec(line)[0].length;
                for (let i = 0; i < tabs; i++)
                    indent += state.facet(indentUnit);
                lineStart.push(pos + indent.length - tabs);
                line = indent + line.slice(tabs);
            }
            text.push(line);
            pos += line.length + 1;
        }
        let ranges = this.fieldPositions.map(pos => new FieldRange(pos.field, lineStart[pos.line] + pos.from, lineStart[pos.line] + pos.to));
        return { text, ranges };
    }
    static parse(template) {
        let fields = [];
        let lines = [], positions = [], m;
        for (let line of template.split(/\r\n?|\n/)) {
            while (m = /[#$]\{(?:(\d+)(?::([^}]*))?|((?:\\[{}]|[^}])*))\}/.exec(line)) {
                let seq = m[1] ? +m[1] : null, rawName = m[2] || m[3] || "", found = -1;
                let name = rawName.replace(/\\[{}]/g, m => m[1]);
                for (let i = 0; i < fields.length; i++) {
                    if (seq != null ? fields[i].seq == seq : name ? fields[i].name == name : false)
                        found = i;
                }
                if (found < 0) {
                    let i = 0;
                    while (i < fields.length && (seq == null || (fields[i].seq != null && fields[i].seq < seq)))
                        i++;
                    fields.splice(i, 0, { seq, name });
                    found = i;
                    for (let pos of positions)
                        if (pos.field >= found)
                            pos.field++;
                }
                positions.push(new FieldPos(found, lines.length, m.index, m.index + name.length));
                line = line.slice(0, m.index) + rawName + line.slice(m.index + m[0].length);
            }
            line = line.replace(/\\([{}])/g, (_, brace, index) => {
                for (let pos of positions)
                    if (pos.line == lines.length && pos.from > index) {
                        pos.from--;
                        pos.to--;
                    }
                return brace;
            });
            lines.push(line);
        }
        return new Snippet(lines, positions);
    }
}
let fieldMarker = /*@__PURE__*/Decoration.widget({ widget: /*@__PURE__*/new class extends WidgetType {
        toDOM() {
            let span = document.createElement("span");
            span.className = "cm-snippetFieldPosition";
            return span;
        }
        ignoreEvent() { return false; }
    } });
let fieldRange = /*@__PURE__*/Decoration.mark({ class: "cm-snippetField" });
class ActiveSnippet {
    constructor(ranges, active) {
        this.ranges = ranges;
        this.active = active;
        this.deco = Decoration.set(ranges.map(r => (r.from == r.to ? fieldMarker : fieldRange).range(r.from, r.to)));
    }
    map(changes) {
        let ranges = [];
        for (let r of this.ranges) {
            let mapped = r.map(changes);
            if (!mapped)
                return null;
            ranges.push(mapped);
        }
        return new ActiveSnippet(ranges, this.active);
    }
    selectionInsideField(sel) {
        return sel.ranges.every(range => this.ranges.some(r => r.field == this.active && r.from <= range.from && r.to >= range.to));
    }
}
const setActive = /*@__PURE__*/StateEffect.define({
    map(value, changes) { return value && value.map(changes); }
});
const moveToField = /*@__PURE__*/StateEffect.define();
const snippetState = /*@__PURE__*/StateField.define({
    create() { return null; },
    update(value, tr) {
        for (let effect of tr.effects) {
            if (effect.is(setActive))
                return effect.value;
            if (effect.is(moveToField) && value)
                return new ActiveSnippet(value.ranges, effect.value);
        }
        if (value && tr.docChanged)
            value = value.map(tr.changes);
        if (value && tr.selection && !value.selectionInsideField(tr.selection))
            value = null;
        return value;
    },
    provide: f => EditorView.decorations.from(f, val => val ? val.deco : Decoration.none)
});
function fieldSelection(ranges, field) {
    return EditorSelection.create(ranges.filter(r => r.field == field).map(r => EditorSelection.range(r.from, r.to)));
}
/**
Convert a snippet template to a function that can
[apply](https://codemirror.net/6/docs/ref/#autocomplete.Completion.apply) it. Snippets are written
using syntax like this:

    "for (let ${index} = 0; ${index} < ${end}; ${index}++) {\n\t${}\n}"

Each `${}` placeholder (you may also use `#{}`) indicates a field
that the user can fill in. Its name, if any, will be the default
content for the field.

When the snippet is activated by calling the returned function,
the code is inserted at the given position. Newlines in the
template are indented by the indentation of the start line, plus
one [indent unit](https://codemirror.net/6/docs/ref/#language.indentUnit) per tab character after
the newline.

On activation, (all instances of) the first field are selected.
The user can move between fields with Tab and Shift-Tab as long as
the fields are active. Moving to the last field or moving the
cursor out of the current field deactivates the fields.

The order of fields defaults to textual order, but you can add
numbers to placeholders (`${1}` or `${1:defaultText}`) to provide
a custom order.

To include a literal `{` or `}` in your template, put a backslash
in front of it. This will be removed and the brace will not be
interpreted as indicating a placeholder.
*/
function snippet(template) {
    let snippet = Snippet.parse(template);
    return (editor, completion, from, to) => {
        let { text, ranges } = snippet.instantiate(editor.state, from);
        let spec = {
            changes: { from, to, insert: Text.of(text) },
            scrollIntoView: true,
            annotations: completion ? [pickedCompletion.of(completion), Transaction.userEvent.of("input.complete")] : undefined
        };
        if (ranges.length)
            spec.selection = fieldSelection(ranges, 0);
        if (ranges.some(r => r.field > 0)) {
            let active = new ActiveSnippet(ranges, 0);
            let effects = spec.effects = [setActive.of(active)];
            if (editor.state.field(snippetState, false) === undefined)
                effects.push(StateEffect.appendConfig.of([snippetState, addSnippetKeymap, snippetPointerHandler, baseTheme]));
        }
        editor.dispatch(editor.state.update(spec));
    };
}
function moveField(dir) {
    return ({ state, dispatch }) => {
        let active = state.field(snippetState, false);
        if (!active || dir < 0 && active.active == 0)
            return false;
        let next = active.active + dir, last = dir > 0 && !active.ranges.some(r => r.field == next + dir);
        dispatch(state.update({
            selection: fieldSelection(active.ranges, next),
            effects: setActive.of(last ? null : new ActiveSnippet(active.ranges, next)),
            scrollIntoView: true
        }));
        return true;
    };
}
/**
A command that clears the active snippet, if any.
*/
const clearSnippet = ({ state, dispatch }) => {
    let active = state.field(snippetState, false);
    if (!active)
        return false;
    dispatch(state.update({ effects: setActive.of(null) }));
    return true;
};
/**
Move to the next snippet field, if available.
*/
const nextSnippetField = /*@__PURE__*/moveField(1);
/**
Move to the previous snippet field, if available.
*/
const prevSnippetField = /*@__PURE__*/moveField(-1);
const defaultSnippetKeymap = [
    { key: "Tab", run: nextSnippetField, shift: prevSnippetField },
    { key: "Escape", run: clearSnippet }
];
/**
A facet that can be used to configure the key bindings used by
snippets. The default binds Tab to
[`nextSnippetField`](https://codemirror.net/6/docs/ref/#autocomplete.nextSnippetField), Shift-Tab to
[`prevSnippetField`](https://codemirror.net/6/docs/ref/#autocomplete.prevSnippetField), and Escape
to [`clearSnippet`](https://codemirror.net/6/docs/ref/#autocomplete.clearSnippet).
*/
const snippetKeymap = /*@__PURE__*/Facet.define({
    combine(maps) { return maps.length ? maps[0] : defaultSnippetKeymap; }
});
const addSnippetKeymap = /*@__PURE__*/Prec.highest(/*@__PURE__*/keymap.compute([snippetKeymap], state => state.facet(snippetKeymap)));
/**
Create a completion from a snippet. Returns an object with the
properties from `completion`, plus an `apply` function that
applies the snippet.
*/
function snippetCompletion(template, completion) {
    return Object.assign(Object.assign({}, completion), { apply: snippet(template) });
}
const snippetPointerHandler = /*@__PURE__*/EditorView.domEventHandlers({
    mousedown(event, view) {
        let active = view.state.field(snippetState, false), pos;
        if (!active || (pos = view.posAtCoords({ x: event.clientX, y: event.clientY })) == null)
            return false;
        let match = active.ranges.find(r => r.from <= pos && r.to >= pos);
        if (!match || match.field == active.active)
            return false;
        view.dispatch({
            selection: fieldSelection(active.ranges, match.field),
            effects: setActive.of(active.ranges.some(r => r.field > match.field)
                ? new ActiveSnippet(active.ranges, match.field) : null),
            scrollIntoView: true
        });
        return true;
    }
});
const closedBracket = /*@__PURE__*/new class extends RangeValue {
};
closedBracket.startSide = 1;
closedBracket.endSide = -1;

/**
A collection of JavaScript-related
[snippets](https://codemirror.net/6/docs/ref/#autocomplete.snippet).
*/
const snippets = [
    /*@__PURE__*/snippetCompletion("function ${name}(${params}) {\n\t${}\n}", {
        label: "function",
        detail: "definition",
        type: "keyword"
    }),
    /*@__PURE__*/snippetCompletion("for (let ${index} = 0; ${index} < ${bound}; ${index}++) {\n\t${}\n}", {
        label: "for",
        detail: "loop",
        type: "keyword"
    }),
    /*@__PURE__*/snippetCompletion("for (let ${name} of ${collection}) {\n\t${}\n}", {
        label: "for",
        detail: "of loop",
        type: "keyword"
    }),
    /*@__PURE__*/snippetCompletion("do {\n\t${}\n} while (${})", {
        label: "do",
        detail: "loop",
        type: "keyword"
    }),
    /*@__PURE__*/snippetCompletion("while (${}) {\n\t${}\n}", {
        label: "while",
        detail: "loop",
        type: "keyword"
    }),
    /*@__PURE__*/snippetCompletion("try {\n\t${}\n} catch (${error}) {\n\t${}\n}", {
        label: "try",
        detail: "/ catch block",
        type: "keyword"
    }),
    /*@__PURE__*/snippetCompletion("if (${}) {\n\t${}\n}", {
        label: "if",
        detail: "block",
        type: "keyword"
    }),
    /*@__PURE__*/snippetCompletion("if (${}) {\n\t${}\n} else {\n\t${}\n}", {
        label: "if",
        detail: "/ else block",
        type: "keyword"
    }),
    /*@__PURE__*/snippetCompletion("class ${name} {\n\tconstructor(${params}) {\n\t\t${}\n\t}\n}", {
        label: "class",
        detail: "definition",
        type: "keyword"
    }),
    /*@__PURE__*/snippetCompletion("import {${names}} from \"${module}\"\n${}", {
        label: "import",
        detail: "named",
        type: "keyword"
    }),
    /*@__PURE__*/snippetCompletion("import ${name} from \"${module}\"\n${}", {
        label: "import",
        detail: "default",
        type: "keyword"
    })
];
/**
A collection of snippet completions for TypeScript. Includes the
JavaScript [snippets](https://codemirror.net/6/docs/ref/#lang-javascript.snippets).
*/
const typescriptSnippets = /*@__PURE__*/snippets.concat([
    /*@__PURE__*/snippetCompletion("interface ${name} {\n\t${}\n}", {
        label: "interface",
        detail: "definition",
        type: "keyword"
    }),
    /*@__PURE__*/snippetCompletion("type ${name} = ${type}", {
        label: "type",
        detail: "definition",
        type: "keyword"
    }),
    /*@__PURE__*/snippetCompletion("enum ${name} {\n\t${}\n}", {
        label: "enum",
        detail: "definition",
        type: "keyword"
    })
]);

const cache = /*@__PURE__*/new NodeWeakMap();
const ScopeNodes = /*@__PURE__*/new Set([
    "Script", "Block",
    "FunctionExpression", "FunctionDeclaration", "ArrowFunction", "MethodDeclaration",
    "ForStatement"
]);
function defID(type) {
    return (node, def) => {
        let id = node.node.getChild("VariableDefinition");
        if (id)
            def(id, type);
        return true;
    };
}
const functionContext = ["FunctionDeclaration"];
const gatherCompletions = {
    FunctionDeclaration: /*@__PURE__*/defID("function"),
    ClassDeclaration: /*@__PURE__*/defID("class"),
    ClassExpression: () => true,
    EnumDeclaration: /*@__PURE__*/defID("constant"),
    TypeAliasDeclaration: /*@__PURE__*/defID("type"),
    NamespaceDeclaration: /*@__PURE__*/defID("namespace"),
    VariableDefinition(node, def) { if (!node.matchContext(functionContext))
        def(node, "variable"); },
    TypeDefinition(node, def) { def(node, "type"); },
    __proto__: null
};
function getScope(doc, node) {
    let cached = cache.get(node);
    if (cached)
        return cached;
    let completions = [], top = true;
    function def(node, type) {
        let name = doc.sliceString(node.from, node.to);
        completions.push({ label: name, type });
    }
    node.cursor(IterMode.IncludeAnonymous).iterate(node => {
        if (top) {
            top = false;
        }
        else if (node.name) {
            let gather = gatherCompletions[node.name];
            if (gather && gather(node, def) || ScopeNodes.has(node.name))
                return false;
        }
        else if (node.to - node.from > 8192) {
            // Allow caching for bigger internal nodes
            for (let c of getScope(doc, node.node))
                completions.push(c);
            return false;
        }
    });
    cache.set(node, completions);
    return completions;
}
const Identifier = /^[\w$\xa1-\uffff][\w$\d\xa1-\uffff]*$/;
const dontComplete = [
    "TemplateString", "String", "RegExp",
    "LineComment", "BlockComment",
    "VariableDefinition", "TypeDefinition", "Label",
    "PropertyDefinition", "PropertyName",
    "PrivatePropertyDefinition", "PrivatePropertyName",
    ".", "?."
];
/**
Completion source that looks up locally defined names in
JavaScript code.
*/
function localCompletionSource(context) {
    let inner = syntaxTree(context.state).resolveInner(context.pos, -1);
    if (dontComplete.indexOf(inner.name) > -1)
        return null;
    let isWord = inner.name == "VariableName" ||
        inner.to - inner.from < 20 && Identifier.test(context.state.sliceDoc(inner.from, inner.to));
    if (!isWord && !context.explicit)
        return null;
    let options = [];
    for (let pos = inner; pos; pos = pos.parent) {
        if (ScopeNodes.has(pos.name))
            options = options.concat(getScope(context.state.doc, pos));
    }
    return {
        options,
        from: isWord ? inner.from : context.pos,
        validFor: Identifier
    };
}

/**
A language provider based on the [Lezer JavaScript
parser](https://github.com/lezer-parser/javascript), extended with
highlighting and indentation information.
*/
const javascriptLanguage = /*@__PURE__*/LRLanguage.define({
    name: "javascript",
    parser: /*@__PURE__*/parser.configure({
        props: [
            /*@__PURE__*/indentNodeProp.add({
                IfStatement: /*@__PURE__*/continuedIndent({ except: /^\s*({|else\b)/ }),
                TryStatement: /*@__PURE__*/continuedIndent({ except: /^\s*({|catch\b|finally\b)/ }),
                LabeledStatement: flatIndent,
                SwitchBody: context => {
                    let after = context.textAfter, closed = /^\s*\}/.test(after), isCase = /^\s*(case|default)\b/.test(after);
                    return context.baseIndent + (closed ? 0 : isCase ? 1 : 2) * context.unit;
                },
                Block: /*@__PURE__*/delimitedIndent({ closing: "}" }),
                ArrowFunction: cx => cx.baseIndent + cx.unit,
                "TemplateString BlockComment": () => null,
                "Statement Property": /*@__PURE__*/continuedIndent({ except: /^{/ }),
                JSXElement(context) {
                    let closed = /^\s*<\//.test(context.textAfter);
                    return context.lineIndent(context.node.from) + (closed ? 0 : context.unit);
                },
                JSXEscape(context) {
                    let closed = /\s*\}/.test(context.textAfter);
                    return context.lineIndent(context.node.from) + (closed ? 0 : context.unit);
                },
                "JSXOpenTag JSXSelfClosingTag"(context) {
                    return context.column(context.node.from) + context.unit;
                }
            }),
            /*@__PURE__*/foldNodeProp.add({
                "Block ClassBody SwitchBody EnumBody ObjectExpression ArrayExpression ObjectType": foldInside,
                BlockComment(tree) { return { from: tree.from + 2, to: tree.to - 2 }; }
            })
        ]
    }),
    languageData: {
        closeBrackets: { brackets: ["(", "[", "{", "'", '"', "`"] },
        commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
        indentOnInput: /^\s*(?:case |default:|\{|\}|<\/)$/,
        wordChars: "$"
    }
});
const jsxSublanguage = {
    test: node => /^JSX/.test(node.name),
    facet: /*@__PURE__*/defineLanguageFacet({ commentTokens: { block: { open: "{/*", close: "*/}" } } })
};
/**
A language provider for TypeScript.
*/
const typescriptLanguage = /*@__PURE__*/javascriptLanguage.configure({ dialect: "ts" }, "typescript");
/**
Language provider for JSX.
*/
const jsxLanguage = /*@__PURE__*/javascriptLanguage.configure({
    dialect: "jsx",
    props: [/*@__PURE__*/sublanguageProp.add(n => n.isTop ? [jsxSublanguage] : undefined)]
});
/**
Language provider for JSX + TypeScript.
*/
const tsxLanguage = /*@__PURE__*/javascriptLanguage.configure({
    dialect: "jsx ts",
    props: [/*@__PURE__*/sublanguageProp.add(n => n.isTop ? [jsxSublanguage] : undefined)]
}, "typescript");
let kwCompletion = (name) => ({ label: name, type: "keyword" });
const keywords = /*@__PURE__*/"break case const continue default delete export extends false finally in instanceof let new return static super switch this throw true typeof var yield".split(" ").map(kwCompletion);
const typescriptKeywords = /*@__PURE__*/keywords.concat(/*@__PURE__*/["declare", "implements", "private", "protected", "public"].map(kwCompletion));
/**
JavaScript support. Includes [snippet](https://codemirror.net/6/docs/ref/#lang-javascript.snippets)
and local variable completion.
*/
function javascript(config = {}) {
    let lang = config.jsx ? (config.typescript ? tsxLanguage : jsxLanguage)
        : config.typescript ? typescriptLanguage : javascriptLanguage;
    let completions = config.typescript ? typescriptSnippets.concat(typescriptKeywords) : snippets.concat(keywords);
    return new LanguageSupport(lang, [
        javascriptLanguage.data.of({
            autocomplete: ifNotIn(dontComplete, completeFromList(completions))
        }),
        javascriptLanguage.data.of({
            autocomplete: localCompletionSource
        }),
        config.jsx ? autoCloseTags : [],
    ]);
}
function findOpenTag(node) {
    for (;;) {
        if (node.name == "JSXOpenTag" || node.name == "JSXSelfClosingTag" || node.name == "JSXFragmentTag")
            return node;
        if (node.name == "JSXEscape" || !node.parent)
            return null;
        node = node.parent;
    }
}
function elementName(doc, tree, max = doc.length) {
    for (let ch = tree === null || tree === void 0 ? void 0 : tree.firstChild; ch; ch = ch.nextSibling) {
        if (ch.name == "JSXIdentifier" || ch.name == "JSXBuiltin" || ch.name == "JSXNamespacedName" ||
            ch.name == "JSXMemberExpression")
            return doc.sliceString(ch.from, Math.min(ch.to, max));
    }
    return "";
}
const android = typeof navigator == "object" && /*@__PURE__*//Android\b/.test(navigator.userAgent);
/**
Extension that will automatically insert JSX close tags when a `>` or
`/` is typed.
*/
const autoCloseTags = /*@__PURE__*/EditorView.inputHandler.of((view, from, to, text, defaultInsert) => {
    if ((android ? view.composing : view.compositionStarted) || view.state.readOnly ||
        from != to || (text != ">" && text != "/") ||
        !javascriptLanguage.isActiveAt(view.state, from, -1))
        return false;
    let base = defaultInsert(), { state } = base;
    let closeTags = state.changeByRange(range => {
        var _a;
        let { head } = range, around = syntaxTree(state).resolveInner(head - 1, -1), name;
        if (around.name == "JSXStartTag")
            around = around.parent;
        if (state.doc.sliceString(head - 1, head) != text || around.name == "JSXAttributeValue" && around.to > head) ;
        else if (text == ">" && around.name == "JSXFragmentTag") {
            return { range, changes: { from: head, insert: `</>` } };
        }
        else if (text == "/" && around.name == "JSXStartCloseTag") {
            let empty = around.parent, base = empty.parent;
            if (base && empty.from == head - 2 &&
                ((name = elementName(state.doc, base.firstChild, head)) || ((_a = base.firstChild) === null || _a === void 0 ? void 0 : _a.name) == "JSXFragmentTag")) {
                let insert = `${name}>`;
                return { range: EditorSelection.cursor(head + insert.length, -1), changes: { from: head, insert } };
            }
        }
        else if (text == ">") {
            let openTag = findOpenTag(around);
            if (openTag && openTag.name == "JSXOpenTag" &&
                !/^\/?>|^<\//.test(state.doc.sliceString(head, head + 2)) &&
                (name = elementName(state.doc, openTag, head)))
                return { range, changes: { from: head, insert: `</${name}>` } };
        }
        return { range };
    });
    if (closeTags.changes.empty)
        return false;
    view.dispatch([
        base,
        state.update(closeTags, { userEvent: "input.complete", scrollIntoView: true })
    ]);
    return true;
});

const { document: document$1 } = globalThis;

const listExtension = () => [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
  javascript(),
];

const play = document$1.getElementById("play");
const stop = document$1.getElementById("stop");
const log = document$1.getElementById("log");

const analysis = new EditorView({
  state: EditorState.create({
    doc: `
      const {
        eval: evalGlobal,
      } = globalThis;
      const {
        log,
        aran,
        astring,
        acorn,
        target,
      } = context;
      log(
        evalGlobal(
          astring.generate(
            aran.instrument(
              acorn.parse(
                target,
                { ecmaVersion: 2024 },
              ),
            ),
          ),
        ),
      );
    `,
    extensions: listExtension(),
  }),
  parent: document$1.getElementById("analysis"),
});

const target = new EditorView({
  state: EditorState.create({
    doc: "'Hello, World!';\n",
    extensions: listExtension(),
  }),
  parent: document$1.getElementById("target"),
});

/**
 * @type {Worker | null}
 */
let worker;

/**
 * @type {() => Worker | null}
 */
const getWorker = () => worker;

/**
 * @type {(
 *   value: Worker | null,
 * ) => void}
 */
const setWorker = (value) => {
  worker = value;
  stop.disabled = value === null;
};

setWorker(null);

play.addEventListener("click", (_event) => {
  log.textContent = "";
  getWorker()?.terminate();
  const worker = new Worker("./aran/worker-bundle.mjs", { type: "module" });
  worker.addEventListener("message", ({ data }) => {
    log.textContent += data;
  });
  worker.postMessage({
    analysis: analysis.state.doc.toString(),
    target: target.state.doc.toString(),
  });
  setWorker(worker);
});

document$1.getElementById("stop").addEventListener("click", (_event) => {
  getWorker()?.terminate();
  setWorker(null);
});
