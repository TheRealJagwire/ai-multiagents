import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

interface MarkdownProps {
  text: string;
}

// Agents constantly emit headings/code fences/lists — rendering that as raw
// text made every response unreadable. marked.parse() is synchronous here
// (no async extensions registered), and DOMPurify strips anything unsafe
// before it ever reaches dangerouslySetInnerHTML.
export function Markdown({ text }: MarkdownProps) {
  const html = DOMPurify.sanitize(marked.parse(text) as string);
  return <div className="sb-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
