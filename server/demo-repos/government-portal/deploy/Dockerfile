FROM golang:1.21-alpine AS build
WORKDIR /src
COPY . .
RUN go build -o /portal ./cmd/portal
FROM alpine:3.18
COPY --from=build /portal /portal
ENTRYPOINT ["/portal"]
