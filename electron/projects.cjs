// Registered through main's trusted sender boundary; no database handles cross IPC.
function registerProjectIpc(ipc, projects) {
  ipc.handle('projects:delete', async (_event, id) => {
    if (typeof id !== 'string' || !/^[\w:-]{1,120}$/.test(id)) {
      throw new Error('Invalid project identifier.');
    }
    await projects.delete(id);
    return true;
  });
}
module.exports = { registerProjectIpc };
