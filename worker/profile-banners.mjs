export const profileBanners = [
  {id: 'forest', name: 'Лес'},
  {id: 'city', name: 'Город'},
  {id: 'blood', name: 'Кровь', ownerOnly: true},
];

export function isProfileBanner(id) {
  return profileBanners.some(banner => banner.id === id);
}

export function canUseBanner(id, position) {
  const banner = profileBanners.find(option => option.id === id);
  return !!banner && (!banner.ownerOnly || position === 'Владелец');
}
