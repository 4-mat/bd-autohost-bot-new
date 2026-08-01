export default {
  username: process.env.PS_USERNAME ?? "",
  password: process.env.PS_PASSWORD ?? "",
  rooms: ["botdevelopment"],
  char: "%",
  devs: [] as string[],
  server: "sim.smogon.com",
  port: 8000,
  useTLS: false,
};
