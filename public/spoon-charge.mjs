export const DEFAULT_CHARGE_NOTICE='스푼을 더 할인된 금액으로 저렴하게 충전할 수 있습니다.';
export const LEGACY_CHARGE_NOTICE='/스푼 <<<< 스푼 할인 충전 안내를 확인해 보세요! 할인 적용 여부와 최종 결제 금액은 충전 화면에서 확인해 주세요.';
export function spoonChargeUrl(region='kr'){
  if(!['kr','jp'].includes(region))throw Error('충전 지역을 확인하세요.');
  return `https://billing.spooncast.net/payment/spoon?country=${region}`;
}
export function spoonChargeReply(notice,region='kr'){
  const url=spoonChargeUrl(region),disclaimer='할인 조건·최종 금액은 공식 충전창에서 확인해 주세요.';
  const message=notice===LEGACY_CHARGE_NOTICE?DEFAULT_CHARGE_NOTICE:String(notice||DEFAULT_CHARGE_NOTICE);
  const budget=200-url.length-disclaimer.length-2;
  return `${message.slice(0,budget).replace(/[\uD800-\uDBFF]$/,'')}\n${disclaimer}\n${url}`;
}
