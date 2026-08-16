export default {
  username: "",
  password: "",
  rooms: ["battledome"],
  char: "%",
  devs: [] as string[],
  server: "sim.smogon.com",
  port: 8000,
  // Default shot-clock length for %cut / %timer when no duration is given.
  turnTimerSeconds: 120,
  // Toggle which event announcements the bot emits to the room.
  announcements: {
    kills: true,
    timer: true,
    join: true,
  },
};
