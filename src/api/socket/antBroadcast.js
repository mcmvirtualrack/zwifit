// ant-broadcast:renumber {} — new random ANT+ device numbers for every broadcast sensor
// (specs/003-ant-plus-broadcast contracts/api.md). Watches and head units must pair again.
// Paired devices only; the payload must be an empty object.
function registerAntBroadcast({ server, antBroadcast, log }) {
	server.handle('ant-broadcast:renumber', 'ant-broadcast-renumber', async ({ device }) => {
		const deviceNumbers = await antBroadcast.renumber();
		log.info(`New ANT+ broadcast device numbers, asked for by "${device.name}"`);
		return { deviceNumbers };
	});
}

module.exports = { registerAntBroadcast };
