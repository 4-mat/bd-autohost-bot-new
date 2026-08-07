function handleConfirm(game: Game, user: User) {
  const isHost = toId(user.name) === toId(game.host);
  const entity = getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No active turn.");
  if (!isHost && toId(entity.name) !== toId(user.name)) {
    return sendPm(user.name, "It's not your turn.");
  }
  if (!entity.pendingAction) {
    return sendPm(user.name, "No action pending. Select an ability first.");
  }

  pushSnapshot(game);

  // Pass through whatever target the player already picked in the UI
  // before hitting confirm -- the pipeline will only fall back to a
  // %target prompt if this doesn't resolve to a valid target.
  const step = startAttack(
    game,
    entity,
    entity.pendingAction.ability,
    entity.pendingAction.target,
  );

  handleAttackStep(game, entity, step);
}

// Shared by %confirm, %choose, and %target -- all three can either finish
// the action outright or pause on another prompt.
function handleAttackStep(game: Game, entity: Entity, step: AttackStep) {
  if (step.done) {
    for (const msg of step.result.messages) {
      send(game.room, msg);
    }
    entity.pendingAction = null;

    const winner = checkGameOver(game);
    if (game.phase === "ended") {
      announceGameOver(game, winner);
      return;
    }

    broadcastPages(game);
    return;
  }

  // Not done -- render the prompt as buttons and wait for %choose/%target.
  renderPrompt(game, entity, step.prompt);
}

function renderPrompt(game: Game, entity: Entity, prompt: AttackPrompt) {
  let html = `<div>${escHtml(prompt.message)}</div>`;
  if (prompt.kind === "selection") {
    html += prompt.options
      .map(
        (o) =>
          `<button name="send" value="%choose ${o.id}">${escHtml(o.label)}</button>`,
      )
      .join(" ");
  } else {
    html += prompt.candidates
      .map(
        (c) =>
          `<button name="send" value="%target ${c.num}">${escHtml(c.num)}</button>`,
      )
      .join(" ");
  }
  sendPmInfobox(entity.name, html);
}

function handleChoose(game: Game, user: User, choiceId: string) {
  const entity = getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No active turn.");
  if (toId(entity.name) !== toId(user.name)) {
    return sendPm(user.name, "It's not your turn.");
  }
  try {
    const step = respondToChoice(entity, choiceId);
    handleAttackStep(game, entity, step);
  } catch (e) {
    sendPm(user.name, e instanceof Error ? e.message : String(e));
  }
}

function handleTarget(game: Game, user: User, targetRef: string) {
  const entity = getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No active turn.");
  if (toId(entity.name) !== toId(user.name)) {
    return sendPm(user.name, "It's not your turn.");
  }
  try {
    const step = respondToTarget(entity, targetRef);
    handleAttackStep(game, entity, step);
  } catch (e) {
    sendPm(user.name, e instanceof Error ? e.message : String(e));
  }
}
