define([
  
],

function() {

  var View = Piece.View.extend({

    el: '#{{module}}-{{view}}',

    type: 'portal',

    render: function() {

      return this;
    }
  });

  return View;

});