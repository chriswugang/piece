define(['text!examples/detailView.html'], function(detailViewTemplate) {

	var View = Piece.View.extend({

		id: 'detailview',

		render: function() {
			$(this.el).html(detailViewTemplate);

			Piece.View.prototype.render.call(this);
			return this;
		},
		onShow: function() {

		}
	});

	return View;
});