// Per-run API budget cap (brief §13 cost test). Every Claude call goes through track().
// Rates: either flat ({input_per_mtok, output_per_mtok, per_search}) or per model
// ({ "claude-sonnet-5-5": {input_per_mtok, output_per_mtok}, per_web_search }).

class Budget {
  constructor({ maxCalls = 150, maxUsd = 25, rates = {} } = {}) {
    this.maxCalls = maxCalls;
    this.maxUsd = maxUsd;
    this.rates = { input_per_mtok: 0, output_per_mtok: 0, per_search: 0, ...rates };
    this.calls = 0;
    this.usd = 0;
    this.log = [];
  }
  rateFor(model) {
    const m = model && this.rates[model];
    return {
      input: m ? m.input_per_mtok : this.rates.input_per_mtok,
      output: m ? m.output_per_mtok : this.rates.output_per_mtok,
      search: this.rates.per_web_search ?? this.rates.per_search ?? 0,
    };
  }
  estimate({ model, input_tokens = 0, output_tokens = 0, searches = 0 }) {
    const r = this.rateFor(model);
    return (input_tokens / 1e6) * r.input + (output_tokens / 1e6) * r.output + searches * r.search;
  }
  check(next = {}) {
    if (this.calls + 1 > this.maxCalls) throw new Error(`BUDGET: call cap ${this.maxCalls} reached`);
    if (this.usd + this.estimate(next) > this.maxUsd) throw new Error(`BUDGET: $${this.maxUsd} cap would be exceeded (spent $${this.usd.toFixed(2)})`);
  }
  track(step, usage = {}) {
    this.check(usage);
    return this.record(step, usage);
  }
  // Record a call that already happened (cost is known only after the response).
  record(step, usage = {}) {
    const cost = this.estimate(usage);
    this.calls += 1;
    this.usd += cost;
    this.log.push({ step, ...usage, est_usd: Math.round(cost * 10000) / 10000 });
    return this.summary();
  }
  summary() { return { calls: this.calls, est_usd: Math.round(this.usd * 100) / 100, remaining_calls: this.maxCalls - this.calls }; }
}

module.exports = { Budget };
