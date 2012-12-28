exports.create = create;
/**
 * Create a map (similar to {} but without the problems described in
 * http://www.devthought.com/2012/01/18/an-object-is-not-a-hash/).
 */
function create() {
  return Object.create(null);
}