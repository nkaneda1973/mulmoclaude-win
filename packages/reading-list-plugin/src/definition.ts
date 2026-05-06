// Tool schema. Lives in its own module so both the server entry
// (`index.ts`) and the browser entry (`vue.ts`) can import it without
// dragging in the factory body, Zod, or any other server-only code.
//
// `name: "manageReadingList" as const` narrows the literal so
// `definePlugin`'s `PluginFactoryResult<N>` requires a handler exported
// under exactly this key.

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageReadingList" as const,
  description:
    "List, save, update, or delete entries in the user's personal reading list. Each book lives as one markdown file with structured YAML frontmatter (title, author, isbn, status, rating, startedAt, finishedAt, tags) plus a free-form markdown body for notes, quotes, or takeaways.",
  parameters: {
    type: "object" as const,
    properties: {
      kind: {
        type: "string",
        enum: ["list", "read", "save", "update", "delete"],
        description: "Operation to perform. Default: list. Use `read` to fetch one book's full body + frontmatter by slug.",
      },
      slug: {
        type: "string",
        description:
          "Book slug (filename). Required for read / save / update / delete. Lowercase ASCII letters, digits, and hyphens; 1-64 chars; no leading/trailing/consecutive hyphens.",
      },
      title: {
        type: "string",
        description: "Display title (any unicode). Required for save and update.",
      },
      author: {
        type: "string",
        description: "Author or authors (free-form, comma-separated when multiple). Required for save and update.",
      },
      isbn: {
        type: "string",
        description: "ISBN-10 or ISBN-13 (digits only or with hyphens). Optional.",
      },
      status: {
        type: "string",
        enum: ["want", "reading", "read", "abandoned"],
        description: "Reading status. Defaults to `want` on save when omitted.",
      },
      rating: {
        type: "integer",
        description: "User's rating, 1-5 stars. Optional.",
      },
      startedAt: {
        type: "string",
        description: "Date the user started the book (ISO 8601 date `YYYY-MM-DD` or full timestamp). Optional.",
      },
      finishedAt: {
        type: "string",
        description: "Date the user finished the book. Optional.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Free-form tags (genre, theme, recommended-by, …). Optional.",
      },
      body: {
        type: "string",
        description: "Markdown body of the entry — notes, quotes, takeaways. Optional; defaults to empty on save.",
      },
    },
    required: ["kind"],
  },
};
