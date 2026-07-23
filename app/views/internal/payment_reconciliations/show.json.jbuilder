json.claimed @result.claimed
json.succeeded @result.succeeded
json.deferred @result.deferred
json.manual_required @result.manual_required
json.failed @result.failed
json.history do
  json.claimed @history.claimed
  json.succeeded @history.succeeded
  json.deferred @history.deferred
  json.failed @history.failed
end
