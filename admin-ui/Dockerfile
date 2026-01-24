FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.json next.config.js postcss.config.js tailwind.config.ts ./
RUN npm ci

COPY app ./app

ARG NEXT_PUBLIC_API_BASE
ARG NEXT_PUBLIC_PROXY_BASE
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}
ENV NEXT_PUBLIC_PROXY_BASE=${NEXT_PUBLIC_PROXY_BASE}

RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/.next ./.next

EXPOSE 3001

CMD ["npm", "start", "--", "-p", "3001"]
