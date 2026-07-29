// Simulation router - loaded by server.js
// All Chinese text uses String.fromCharCode to avoid encoding issues
const _ = String.fromCharCode;

module.exports = function(app, sessions, callLLM, getActiveHistory, pushToActive, autoName) {

const ERR_SESS = _(20250,35805,19981,23384,22312);
const ERR_TEXT = _(26696,20363,25991,26412,19981,36275);
const ERR_CHOICE = _(35831,20570,20986,36873,25324);
const BT3 = _(96,96,96);

// Start simulation
app.post("/api/simulation/start", async (req, res) => {
  try {
    const sess = sessions[req.body.sid];
    if (!sess) return res.json({ error: ERR_SESS });
    if (req.body.selectedRoles && req.body.selectedRoles.length > 0) sess.selectedRoles = req.body.selectedRoles;
    if (sess.caseText.length < 100) return res.json({ error: ERR_TEXT });
    // Use selected roles from request or fallback to session
    if (req.body.selectedRoles && req.body.selectedRoles.length > 0) sess.selectedRoles = req.body.selectedRoles;
    if (!sess.selectedRoles || sess.selectedRoles.length === 0) return res.json({ error: '请先选择参与角色' });

    const excerpt = sess.caseText.substring(0, 5000);
    const useRoles = sess.selectedRoles && sess.selectedRoles.length > 0 ? sess.selectedRoles : sess.roles;
    const charList = useRoles.map(r => r.name + "(" + r.title + ")").join(_(92,110,45,32)) || _(21508,26041,35282,33394);
    const r1 = _(20320,26159,19968,20010,26696,20363,25512,28436,21405,20107,24378,24615,12290,20197,19979,26159,26696,20363,25991,26412,25688,35201,21644,30456,20851,35282,33394,12290);
    const r2 = _(26696,20363,25688,35201,65306);
    const r3 = _(35282,33394,33394,21015,34920,65306);
    const r4 = _(20219,21153,65306,29983,25104,26696,20363,25512,28436,30340,21021,22987,22330,26223,12290);
    const r5 = _(26684,24335,35201,27714,65306,36755,20986,74,83,79,78,23545,35937,65292,21253,21547,20197,19979,23383,27573,65306);
    const n1 = "1. narration: string - " + _(22330,26223,26049,30333,25551,36848,65288,50,48,48,23383,20197,20869,65292,21475,35821,21270,65292,35774,23450,22330,26223,12289,26102,38388,12289,32972,26223,65289);
    const n2 = "2. characters: array - " + _(27599,20010,20803,32032,123,110,97,109,101,44,32,99,111,110,116,101,110,116,44,32,116,105,116,108,101,125,34920,31034,35813,35282,33394,22312,27492,22330,26223,20013,30340,21457,35328,65295,21453,24212,65289);
    const n3 = _(20005,26684,36981,24490,26696,20363,32032,26448,65292,31105,27490,32534,36947,12290,21482,36755,20986,74,83,79,78,65292,19981,35201,20854,20182,25991,23383,12290);
    const q1 = _(35831,26681,25454,26696,20363,29983,25104,25512,28436,21021,22987,22330,26223,12290);

    const sysPrompt = r1 + _(92,110,92,110) + r2 + excerpt.substring(0, 2000) + _(92,110,92,110)
      + r3 + _(92,110,45,32) + charList + _(92,110,92,110)
      + r4 + _(92,110)
      + r5 + _(92,110)
      + n1 + _(92,110)
      + n2 + _(92,110)
      + "   - " + _(27599,20010,35282,33394,30340,21457,35328,35201,20307,29616,20854,36523,20221,31435,22330) + _(92,110)
      + "   - " + _(20351,29992,21475,35821,21270,34920,36798,65292,31105,27490,23398,26415,35789,27719) + _(92,110)
      + "   - " + _(27599,27573,20869,23481,53,48,45,49,53,48,23383) + _(92,110)
      + "3. decisionPrompt: string - " + _(21521,29992,25152,25552,20986,30340,20915,31574,38382,39064) + _(92,110)
      + "4. options: [string, string, string] - " + _(19977,20010,20915,31574,36873,39033) + _(92,110,92,110)
      + n3;

    const result = await callLLM([
      { role: "system", content: sysPrompt },
      { role: "user", content: q1 }
    ], 0.7);
    if (result.error) return res.status(500).json({ error: result.error });

    let parsed = null;
    try {
      const re = new RegExp(BT3 + "json\\s*", "g");
      const re2 = new RegExp(BT3 + "\\s*", "g");
      const cl = result.text.replace(re, "").replace(re2, "").trim();
      parsed = JSON.parse(cl);
    } catch(e) {
      parsed = { narration: result.text, characters: [], decisionPrompt: _(35831,20570,20986,24744,30340,20915,31574), options: [_(32487,32493,25512,36827), _(37325,26032,35780,20272), _(23547,27714,25903,25345)] };
    }

    sess.modules.simulation.currentRound = parsed;
    sess.modules.simulation.roundIndex = (sess.modules.simulation.roundIndex || 0) + 1;

    const NARR = _(12304,26049,30333,12305);
    const DEC = _(12304,20915,31574,12305);

    if (parsed.narration) {
      pushToActive(sess.modules.simulation, { role: "assistant", content: NARR + parsed.narration });
    }
    if (parsed.characters) {
      parsed.characters.forEach(c => {
        if (c && c.name && c.content) {
          pushToActive(sess.modules.simulation, { role: "assistant", content: c.name + _(65306) + c.content, character: c.name });
        }
      });
    }

    res.json({
      narration: parsed.narration || "",
      characters: parsed.characters || [],
      decisionPrompt: parsed.decisionPrompt || "",
      options: parsed.options || [],
      round: sess.modules.simulation.roundIndex
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Continue simulation round
app.post("/api/simulation/round", async (req, res) => {
  try {
    const sess = sessions[req.body.sid];
    if (!sess) return res.json({ error: ERR_SESS });
    const choice = req.body.choice || "";
    if (!choice) return res.json({ error: ERR_CHOICE });

    const excerpt = sess.caseText.substring(0, 5000);
    const useRoles = sess.selectedRoles && sess.selectedRoles.length > 0 ? sess.selectedRoles : sess.roles;
    const charList = useRoles.map(r => r.name + "(" + r.title + ")").join(_(92,110,45,32)) || _(21508,26041,35282,33394);
    const history = getActiveHistory(sess.modules.simulation).slice(-10).map(m => (m.character ? "[" + m.character + "]" : "") + m.content).join(_(92,110));

    const r1 = _(20320,26159,19968,20010,26696,20363,25512,28436,21405,20107,24378,24615,12290,20197,19979,26159,26696,20363,25688,35201,21644,30456,20851,35282,33394,12290);
    const r2 = _(26696,20363,25688,35201,65306);
    const r3 = _(35282,33394,33394,21015,34920,65306);
    const r4 = _(19978,19968,36718,21095,24773,65306);
    const r5 = _(29992,25143,20570,20986,20102,20197,19979,20915,31574,65306);
    const r6 = _(20219,21153,65306,26681,25454,29992,25143,30340,20915,31574,65292,29983,25104,19979,19968,36718,25512,28436,20869,23481,12290);
    const r7 = _(26684,24335,35201,27714,65306,36755,20986,74,83,79,78,23545,35937,65292,21253,21547,20197,19979,23383,27573,65306);
    const n1 = "1. narration: string - " + _(29992,25143,20915,31574,21518,30340,21453,24212,21644,22330,26223,21464,21270,65292,50,48,48,23383,20197,20869,65292,21475,35821,21270,65289);
    const n2 = "2. characters: array - " + _(27599,20010,20803,32032,123,32,110,97,109,101,44,32,99,111,110,116,101,110,116,44,32,116,105,116,108,101,32,125,65292,21508,35282,33394,23545,20915,31574,30340,21453,24212,21644,21457,35328,65289);
    const n3 = _(20005,26684,36981,24490,26696,20363,32032,26448,65292,31105,27490,32534,36947,12290,21482,36755,20986,74,83,79,78,65292,19981,35201,20854,20182,25991,23383,12290);
    const q1 = _(35831,26681,25454,29992,25143,30340,20915,31574,29983,25104,19979,19968,36718,25512,28436,12290);

    const sysPrompt = r1 + _(92,110,92,110) + r2 + excerpt.substring(0, 2000) + _(92,110,92,110)
      + r3 + _(92,110,45,32) + charList + _(92,110,92,110)
      + r4 + history.substring(0, 1500) + _(92,110,92,110)
      + r5 + choice + _(92,110,92,110)
      + r6 + _(92,110)
      + r7 + _(92,110)
      + n1 + _(92,110)
      + n2 + _(92,110)
      + "3. decisionPrompt: string - " + _(19979,19968,36718,20915,31574,38382,39064) + _(92,110)
      + "4. options: [string, string, string] - " + _(19977,20010,20915,31574,36873,39033) + _(92,110,92,110)
      + n3;

    const result = await callLLM([
      { role: "system", content: sysPrompt },
      { role: "user", content: q1 }
    ], 0.7);
    if (result.error) return res.status(500).json({ error: result.error });

    let parsed = null;
    try {
      const re = new RegExp(BT3 + "json\\s*", "g");
      const re2 = new RegExp(BT3 + "\\s*", "g");
      const cl = result.text.replace(re, "").replace(re2, "").trim();
      parsed = JSON.parse(cl);
    } catch(e) {
      parsed = { narration: result.text, characters: [], decisionPrompt: _(35831,20570,20986,24744,30340,20915,31574), options: [_(32487,32493,25512,36827), _(37325,26032,35780,20272), _(23547,27714,25903,25345)] };
    }

    sess.modules.simulation.currentRound = parsed;
    sess.modules.simulation.roundIndex = (sess.modules.simulation.roundIndex || 0) + 1;

    const NARR = _(12304,26049,30333,12305);
    const DEC = _(12304,20915,31574,12305);

    pushToActive(sess.modules.simulation, { role: "user", content: DEC + choice });
    if (parsed.narration) {
      pushToActive(sess.modules.simulation, { role: "assistant", content: NARR + parsed.narration });
    }
    if (parsed.characters) {
      parsed.characters.forEach(c => {
        if (c && c.name && c.content) {
          pushToActive(sess.modules.simulation, { role: "assistant", content: c.name + _(65306) + c.content, character: c.name });
        }
      });
    }

    res.json({
      narration: parsed.narration || "",
      characters: parsed.characters || [],
      decisionPrompt: parsed.decisionPrompt || "",
      options: parsed.options || [],
      round: sess.modules.simulation.roundIndex
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

};
