export type AllowedImage = {
  name: string;
  dockerHubUrl: string;
  defaultPort: number;
  description: string;
  env?: Record<string, string>;
};

export const allowedImages: AllowedImage[] = [
  {
    name: "langchain/langchain",
    dockerHubUrl: "https://hub.docker.com/r/langchain/langchain",
    defaultPort: 8000,
    description: "LangChain agent container (example).",
  },
  {
    name: "crewai/crewai",
    dockerHubUrl: "https://hub.docker.com/r/crewai/crewai",
    defaultPort: 8000,
    description: "CrewAI agent container (example).",
  },
  {
    name: "modelcontextprotocol/server",
    dockerHubUrl: "https://hub.docker.com/r/modelcontextprotocol/server",
    defaultPort: 3000,
    description: "MCP server base image (example).",
  },
];

export const allowedImageNames = new Set(allowedImages.map((image) => image.name));

export const getAllowedImage = (name: string) =>
  allowedImages.find((image) => image.name === name);
