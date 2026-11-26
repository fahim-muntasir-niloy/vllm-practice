"use generative";

// The agent's tools run in Python (see agent/), so these entries only say how to draw each call.
// A tool that isn't listed here still renders, through the fallback in App.tsx.
import { defineToolkit, externalTool } from "@assistant-ui/react";
import { z } from "zod";
import { ToolCall } from "@/agent/tool-call";

export default defineToolkit({
  search_web: {
    parameters: z.object({ query: z.string() }),
    execute: externalTool(),
    render: ToolCall,
  },
  write_todos: {
    parameters: z.object({ todos: z.array(z.object({ content: z.string(), status: z.string() })) }),
    execute: externalTool(),
    render: ToolCall,
  },
  task: {
    parameters: z.object({ description: z.string(), subagent_type: z.string() }),
    execute: externalTool(),
    render: ToolCall,
  },
  ls: {
    parameters: z.object({ path: z.string() }),
    execute: externalTool(),
    render: ToolCall,
  },
  read_file: {
    parameters: z.object({ file_path: z.string() }),
    execute: externalTool(),
    render: ToolCall,
  },
  write_file: {
    parameters: z.object({ file_path: z.string(), content: z.string() }),
    execute: externalTool(),
    render: ToolCall,
  },
  edit_file: {
    parameters: z.object({ file_path: z.string(), old_string: z.string(), new_string: z.string() }),
    execute: externalTool(),
    render: ToolCall,
  },
  glob: {
    parameters: z.object({ pattern: z.string() }),
    execute: externalTool(),
    render: ToolCall,
  },
  grep: {
    parameters: z.object({ pattern: z.string() }),
    execute: externalTool(),
    render: ToolCall,
  },
  execute: {
    parameters: z.object({ command: z.string() }),
    execute: externalTool(),
    render: ToolCall,
  },
});
