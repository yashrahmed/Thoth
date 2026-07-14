import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import "./markdown-message.css";

type MarkdownMessageProps = {
  readonly content: string;
};

type MarkdownTree = {
  children: MarkdownTreeNode[];
};

type MarkdownTreeNode = {
  readonly type: string;
  readonly value?: string;
  readonly children?: MarkdownTreeNode[];
  readonly [key: string]: unknown;
};

const HTML_LINE_BREAK_PATTERN = /^<br\s*\/?\s*>$/i;

const markdownComponents: Components = {
  a({ href, children }) {
    const opensNewTab = /^(?:https?:)?\/\//i.test(href ?? "");

    return (
      <a href={href} target={opensNewTab ? "_blank" : undefined} rel={opensNewTab ? "noreferrer noopener" : undefined}>
        {children}
      </a>
    );
  },
  code({ className, children }) {
    const language = /(?:^|\s)language-([\w-]+)/.exec(className ?? "")?.[1];

    return (
      <code className={className} data-language={language}>
        {children}
      </code>
    );
  },
  img({ src, alt, title }) {
    return <img src={src} alt={alt ?? ""} title={title} loading="lazy" referrerPolicy="no-referrer" />;
  },
};

/**
 * Chat completions commonly put HTML line breaks inside GFM table cells.
 * Permit only that inert element and turn every other raw HTML node into text.
 */
function rehypeSafeLineBreaks() {
  return (tree: MarkdownTree) => replaceRawHtml(tree);
}

function replaceRawHtml(parent: MarkdownTree): void {
  parent.children = parent.children.map((child) => {
    if (child.type === "raw") {
      const value = child.value ?? "";

      if (HTML_LINE_BREAK_PATTERN.test(value.trim())) {
        return { type: "element", tagName: "br", properties: {}, children: [] };
      }

      return { type: "text", value };
    }

    if (child.children) {
      replaceRawHtml(child as MarkdownTree);
    }

    return child;
  });
}

/**
 * Renders stored message text as safe Markdown. GitHub-flavored Markdown is
 * enabled, useful table line breaks are preserved, and executable raw HTML is
 * always rendered as inert text.
 */
export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="markdown-message">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSafeLineBreaks]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
