FROM node:lts-alpine as builder

RUN apk add --no-cache git python3 build-base

WORKDIR /opt/mojaloop-payment-manager-experience-api

COPY package.json package-lock.json* /opt/mojaloop-payment-manager-experience-api/
COPY src /opt/mojaloop-payment-manager-experience-api/src

RUN npm install --production --no-optional

FROM node:lts-alpine

WORKDIR /opt/mojaloop-payment-manager-experience-api

COPY --from=builder /opt/mojaloop-payment-manager-experience-api .

EXPOSE 3000

CMD ["node", "src/index.js"]
